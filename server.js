// Voice → form → PDF server (Node 20.12+, only dependency: pdf-lib).
// Keeps the Groq API key on the server; the browser never sees it.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { FORMS, fieldsOf } from './forms.js';
import { buildPlacementPdf, reference as placementRef } from './documents/placement.js';
import { INDEX_HTML } from './publicHtml.js';

// Document generators per form (add e.g. receipt: buildReceiptPdf here later)
const DOCUMENTS = { placement: { build: buildPlacementPdf, ref: placementRef } };

const ROOT = import.meta.dirname || path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* no .env yet */ }

const PORT = Number(process.env.PORT) || 5173;
const GROQ = 'https://api.groq.com/openai/v1';
const STT_MODEL = process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo';
const LLM_MODEL = process.env.GROQ_LLM_MODEL || 'openai/gpt-oss-120b';
const PUBLIC = path.join(ROOT, 'public');
const BUNDLED_DATA_FILE = path.join(ROOT, 'data', 'submissions.json');
const WRITABLE_DATA_FILE = process.env.VERCEL
  ? path.join(os.tmpdir(), 'submissions.json')
  : BUNDLED_DATA_FILE;
const MAX_AUDIO = 25 * 1024 * 1024; // Groq free-tier file limit

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

async function readBody(req, limit) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (req.body && typeof req.body === 'object') return Buffer.from(JSON.stringify(req.body));
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'Upload too large (max 25 MB).');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

function apiKey() {
  const k = process.env.GROQ_API_KEY;
  if (!k || k.startsWith('your_')) throw new HttpError(500, 'GROQ_API_KEY is missing. Copy .env.example to .env and paste your free key from console.groq.com/keys, then restart the server.');
  return k;
}

async function groq(endpoint, init) {
  const r = await fetch(GROQ + endpoint, { ...init, headers: { Authorization: `Bearer ${apiKey()}`, ...init.headers } });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  if (!r.ok) throw new HttpError(r.status === 401 ? 401 : 502, 'Groq: ' + (json?.error?.message || text.slice(0, 300)));
  return json;
}

// ---------- Speech → text (Groq Whisper) ----------
async function transcribe(req, url) {
  const audio = await readBody(req, MAX_AUDIO);
  if (audio.length < 1000) throw new HttpError(400, 'Recording is empty or too short.');
  const type = (req.headers['content-type'] || 'audio/webm').split(';')[0];
  const ext = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/x-m4a': 'm4a', 'video/webm': 'webm', 'video/mp4': 'mp4' }[type] || 'webm';
  const fd = new FormData();
  fd.append('file', new Blob([audio], { type }), `speech.${ext}`);
  fd.append('model', STT_MODEL);
  fd.append('response_format', 'json');
  fd.append('temperature', '0');
  // Hint vocabulary so names of fields/currencies come out right.
  fd.append('prompt', `${process.env.STT_VOCABULARY || 'Rizurf Realty'}. Real estate tenant placement agreement: landlord, tenant, property address, unit, rent, AED, SAR, cheques, security deposit, placement fee, agency.`);
  const lang = url.searchParams.get('lang');
  if (lang) fd.append('language', lang);
  const out = await groq('/audio/transcriptions', { method: 'POST', body: fd });
  return { text: (out.text || '').trim() };
}

// ---------- Text → form fields (Groq LLM, JSON mode) ----------
function buildPrompt(form, current) {
  const lines = fieldsOf(form).map((f) => {
    let t = f.type === 'number' ? 'number' : 'string';
    if (f.type === 'date') t = 'string YYYY-MM-DD';
    if (f.options) t = `one of: ${f.options.map((o) => JSON.stringify(o)).join(', ')}`;
    return `- "${f.key}" (${f.label}): ${t}${f.hint ? '. ' + f.hint : ''}`;
  });
  const filled = Object.fromEntries(Object.entries(current || {}).filter(([, v]) => v !== '' && v != null));
  return `You fill in a "${form.title}" form for a real estate business from a spoken transcript.
${form.description}
Today's date is ${new Date().toISOString().slice(0, 10)}.

Fields:
${lines.join('\n')}

Rules:
- Return a JSON object: {"values": {...}, "missing": [...]}.
- "values" contains ONLY fields the transcript gives information for. Never guess or invent values.
- Numbers must be plain numbers (no currency symbols or commas). "two and a half thousand" = 2500.
- Resolve relative dates ("next Monday", "first of March") against today's date.
- The transcript may be in any language (e.g. Arabic); write names in the Latin alphabet as spoken, and free-text fields in the transcript's language.
- If the speaker corrects themselves, use the final value.
- The transcript comes from speech recognition, which often misspells these known names: ${process.env.STT_VOCABULARY || 'Rizurf Realty'}. If a word in the transcript sounds similar to one of them (e.g. "Resurf Rialty", "Reserve Realty" for "Rizurf Realty"), output the known spelling instead.
- "missing" lists keys of important fields still empty after this update.
${Object.keys(filled).length ? `\nThe form already contains:\n${JSON.stringify(filled)}\nThe transcript may be a follow-up that adds or changes values ("change the rent to 5000"). Only output fields that should change.` : ''}`;
}

function clean(form, values) {
  const out = {};
  for (const f of fieldsOf(form)) {
    let v = values?.[f.key];
    if (v == null || v === '') continue;
    if (f.type === 'number') { v = Number(String(v).replace(/[^\d.-]/g, '')); if (!Number.isFinite(v)) continue; }
    else if (f.options) { v = f.options.find((o) => o.toLowerCase() === String(v).toLowerCase()); if (!v) continue; }
    else if (f.type === 'date') { v = String(v).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) continue; }
    else if (f.type === 'email') v = String(v).toLowerCase().replace(/\s+/g, '');
    else if (f.type === 'tel') v = String(v).replace(/(?!^\+)[^\d]/g, '');
    else v = String(v).trim();
    out[f.key] = v;
  }
  return out;
}

async function extract(req) {
  const { form: formId, transcript, current } = JSON.parse((await readBody(req, 1e6)).toString() || '{}');
  const form = FORMS[formId];
  if (!form) throw new HttpError(404, 'Unknown form.');
  if (!transcript?.trim()) throw new HttpError(400, 'Transcript is empty.');
  const out = await groq('/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature: 0,
      ...(LLM_MODEL.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildPrompt(form, current) },
        { role: 'user', content: `Transcript:\n"""${transcript.trim()}"""` },
      ],
    }),
  });
  let parsed; try { parsed = JSON.parse(out.choices[0].message.content); } catch { throw new HttpError(502, 'AI returned invalid JSON, try again.'); }
  const values = clean(form, parsed.values ?? parsed);
  const keys = new Set(fieldsOf(form).map((f) => f.key));
  return { values, missing: (parsed.missing || []).filter((k) => keys.has(k)) };
}

// ---------- Submissions (stored in data/submissions.json or /tmp on Vercel) ----------
const readSubs = async () => {
  if (WRITABLE_DATA_FILE !== BUNDLED_DATA_FILE) {
    try {
      return JSON.parse(await fs.readFile(WRITABLE_DATA_FILE, 'utf8'));
    } catch {
      // not yet written to tmp, fall back to bundled seed file
    }
  }
  try {
    return JSON.parse(await fs.readFile(BUNDLED_DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
};

async function saveSubmission(req) {
  const { form: formId, values } = JSON.parse((await readBody(req, 1e6)).toString() || '{}');
  const form = FORMS[formId];
  if (!form) throw new HttpError(404, 'Unknown form.');
  const list = await readSubs();
  const entry = { id: Date.now().toString(36), form: formId, createdAt: new Date().toISOString(), values: clean(form, values) };
  list.push(entry);
  await fs.mkdir(path.dirname(WRITABLE_DATA_FILE), { recursive: true });
  await fs.writeFile(WRITABLE_DATA_FILE, JSON.stringify(list, null, 2));
  return entry;
}

// ---------- PDF documents ----------
async function sendPdf(res, formId, values, id, download) {
  const gen = DOCUMENTS[formId];
  if (!gen) throw new HttpError(404, 'No document template for this form.');
  const clean_ = clean(FORMS[formId], values);
  const bytes = await gen.build(clean_, { id });
  const name = `${gen.ref(clean_, id)}.pdf`.replace(/[^\w.-]+/g, '_');
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name}"`,
    'Cache-Control': 'no-store',
  });
  res.end(Buffer.from(bytes));
}

// ---------- Static files ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
async function serveStatic(res, pathname) {
  const norm = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.replace(/^\//, ''));
  if (norm === 'index.html') {
    return send(res, 200, INDEX_HTML, 'text/html; charset=utf-8');
  }
  const candidate1 = path.join(PUBLIC, norm);
  const candidate2 = path.join(ROOT, norm);

  for (const file of [candidate1, candidate2]) {
    try {
      const data = await fs.readFile(file);
      return send(res, 200, data, TYPES[path.extname(file)] || 'application/octet-stream');
    } catch {
      // try next
    }
  }
  throw new HttpError(404, 'Not found');
}

export async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = req.headers['x-matched-path'] || url.pathname;
  try {
    const route = `${req.method} ${pathname}`;
    if (route === 'GET /api/config') return send(res, 200, { hasKey: !!process.env.GROQ_API_KEY && !process.env.GROQ_API_KEY.startsWith('your_'), stt: STT_MODEL, llm: LLM_MODEL });
    if (req.method === 'GET' && pathname.startsWith('/api/forms/')) {
      const form = FORMS[pathname.split('/').pop()];
      return form ? send(res, 200, form) : send(res, 404, { error: 'Unknown form.' });
    }
    if (route === 'POST /api/transcribe') return send(res, 200, await transcribe(req, url));
    if (route === 'POST /api/extract') return send(res, 200, await extract(req));
    if (route === 'GET /api/submissions') return send(res, 200, await readSubs());
    if (route === 'POST /api/submissions') return send(res, 200, await saveSubmission(req));
    if (route === 'POST /api/pdf') {
      const { form: formId, values } = JSON.parse((await readBody(req, 1e6)).toString() || '{}');
      if (!FORMS[formId]) throw new HttpError(404, 'Unknown form.');
      return await sendPdf(res, formId, values, null, false);
    }
    const pdfMatch = req.method === 'GET' && pathname.match(/^\/api\/submissions\/([\w-]+)\/pdf$/);
    if (pdfMatch) {
      const s = (await readSubs()).find((x) => x.id === pdfMatch[1]);
      if (!s) throw new HttpError(404, 'Submission not found.');
      return await sendPdf(res, s.form, s.values, s.id, url.searchParams.has('download'));
    }
    if (req.method === 'GET') return await serveStatic(res, pathname);
    throw new HttpError(404, 'Not found');
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    send(res, err.status || 500, { error: err.message || 'Server error' });
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};

export default handleRequest;

const isDirectRun = !process.env.VERCEL && process.argv[1] && (
  process.argv[1].endsWith('server.js') ||
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
);

if (isDirectRun) {
  http.createServer(handleRequest).listen(PORT, () => {
    console.log(`Voice Form running at http://localhost:${PORT}`);
    if (!process.env.GROQ_API_KEY) console.log('⚠  GROQ_API_KEY not set — copy .env.example to .env and add your key.');
  });
}

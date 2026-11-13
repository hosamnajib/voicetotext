// Tenant Placement Agreement → PDF
import { createDoc, COLORS, safe } from './pdf-kit.js';

const fmtDate = (s) => {
  if (!s) return '';
  const d = new Date(s + 'T00:00:00Z');
  return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const money = (n, cur) => (n == null || n === '' ? '' : `${cur ? cur + ' ' : ''}${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
const PER_YEAR = { Monthly: 12, Quarterly: 4, 'Semi-annually': 2, Annually: 1 };

function leaseEnd(start, months) {
  if (!start || !months) return '';
  const d = new Date(start + 'T00:00:00Z');
  if (isNaN(d)) return '';
  d.setUTCMonth(d.getUTCMonth() + Number(months));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function reference(values, id) {
  if (values.agreement_number) return values.agreement_number;
  const date = (values.agreement_date || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  return `TPA-${date}-${(id || Math.random().toString(36).slice(2, 6)).toUpperCase().slice(-4)}`;
}

export async function buildPlacementPdf(v, { id } = {}) {
  const agency = v.agency_name || 'The Agency';
  const ref = reference(v, id);
  const cur = v.currency || '';
  const monthly = v.monthly_rent != null && v.monthly_rent !== '' ? Number(v.monthly_rent) : null;
  const annual = monthly != null ? monthly * 12 : null;

  let feeBasis = '', feeAmount = null;
  if (v.placement_fee != null && v.placement_fee !== '') {
    const f = Number(v.placement_fee);
    if (v.placement_fee_type === 'Percent of annual rent') { feeBasis = `${f}% of annual rent`; if (annual != null) feeAmount = (annual * f) / 100; }
    else if (v.placement_fee_type === 'Months of rent') { feeBasis = `${f} month${f === 1 ? '' : 's'} of rent`; if (monthly != null) feeAmount = monthly * f; }
    else { feeBasis = 'Fixed amount'; feeAmount = f; }
  }
  const installments = PER_YEAR[v.payment_frequency];
  const end = leaseEnd(v.lease_start, v.lease_term_months);

  const doc = await createDoc({ footerLeft: `${agency}  ·  Tenant Placement Agreement  ·  Ref ${ref}` });
  const { fonts, M } = doc;
  doc.newPage();

  // ---- Header ----
  const top = doc.y;
  doc.page.drawText(safe(agency).toUpperCase(), { x: M, y: top - 12, size: 12, font: fonts.bold, color: COLORS.accent });
  const meta = [`Ref: ${ref}`, `Date: ${fmtDate(v.agreement_date) || '____________'}`];
  meta.forEach((t, i) => {
    const s = safe(t);
    doc.page.drawText(s, { x: doc.W - M - fonts.regular.widthOfTextAtSize(s, 9), y: top - 10 - i * 13, size: 9, font: fonts.regular, color: COLORS.muted });
  });
  doc.y = top - 44;
  doc.text('TENANT PLACEMENT AGREEMENT', { font: fonts.bold, size: 20, gap: 6 });
  doc.text('Agreement for the introduction and placement of a tenant', { size: 10, color: COLORS.muted });
  doc.space(10);

  const landlord = v.landlord_name || '____________________';
  const agentClause = v.agent_name ? `${agency}, represented by ${v.agent_name}` : agency;
  doc.text(
    `This Tenant Placement Agreement ("Agreement") is made on ${fmtDate(v.agreement_date) || '____________'} between ${landlord} ("the Landlord") and ${agentClause} ("the Agent"), in respect of the placement of ${v.tenant_name || 'a tenant'} ("the Tenant") in the property described below.`,
    { size: 10, gap: 5 },
  );

  // ---- 1. Parties ----
  doc.section('1. The Parties');
  doc.boxes([
    { title: 'Landlord', rows: [['Name', v.landlord_name], ['Phone', v.landlord_phone], ['Email', v.landlord_email]] },
    { title: 'Tenant', rows: [['Name', v.tenant_name], ['Phone', v.tenant_phone], ['Email', v.tenant_email]] },
  ]);

  // ---- 2. Property ----
  doc.section('2. The Property');
  doc.table([
    ['Address', v.property_address],
    ['Unit / apartment no.', v.unit_number],
    ['Property type', v.property_type],
    ['Bedrooms', v.bedrooms === 0 || v.bedrooms === '0' ? 'Studio' : v.bedrooms != null && v.bedrooms !== '' ? String(v.bedrooms) : ''],
  ]);

  // ---- 3. Lease ----
  doc.section('3. Lease Terms');
  doc.table([
    ['Lease start date', fmtDate(v.lease_start)],
    ['Lease term', v.lease_term_months ? `${v.lease_term_months} months` : ''],
    ['Lease end date', fmtDate(end)],
    ['Monthly rent', money(monthly, cur)],
    ['Annual rent', money(annual, cur)],
    ['Rent payment', v.payment_frequency ? `${v.payment_frequency}${installments && annual != null ? ` (${installments} payment${installments > 1 ? 's' : ''} of ${money(annual / installments, cur)})` : ''}` : ''],
    ['Security deposit', money(v.security_deposit, cur)],
  ]);

  // ---- 4. Fee ----
  doc.section('4. Placement Fee');
  doc.table([
    ['Fee basis', feeBasis],
    ['Fee amount', money(feeAmount, cur)],
    ['Payable by', v.fee_paid_by === 'Split' ? 'Landlord and Tenant in equal shares' : v.fee_paid_by],
    ['Due', 'On signing of the lease agreement'],
  ]);

  // ---- 5. Special terms ----
  doc.section('5. Special Terms');
  doc.text(v.special_terms || 'None.', { size: 10, gap: 5 });

  // ---- 6. General terms ----
  doc.section('6. General Terms');
  const clauses = [
    'The Agent will market the Property, introduce and screen prospective tenants, and coordinate the signing of the lease between the Landlord and the Tenant.',
    'The Placement Fee is earned when the lease is signed by the Landlord and the Tenant, and is payable on that date. Once paid it is non-refundable unless agreed otherwise in writing.',
    'The Agent does not guarantee the Tenant\'s payment of rent or performance of the lease. The Landlord is responsible for the lease agreement and its enforcement.',
    'The Landlord confirms that they own the Property or are authorised to let it, and that the information given in this Agreement is accurate.',
    'The security deposit will be held and returned in accordance with the lease agreement and applicable law.',
    'Any change to this Agreement must be made in writing and signed by the Landlord and the Agent.',
    'This Agreement is governed by the laws applicable in the jurisdiction where the Property is located.',
  ];
  clauses.forEach((c, i) => {
    const label = `6.${i + 1}`;
    doc.ensure(28);
    doc.page.drawText(label, { x: M, y: doc.y - 9.5, size: 9.5, font: fonts.bold, color: COLORS.muted });
    doc.text(c, { size: 9.5, gap: 4, x: M + 26, width: doc.width - 26 });
    doc.space(3);
  });

  // ---- 7. Signatures ----
  doc.section('7. Signatures');
  doc.text('By signing below, the parties agree to the terms of this Agreement.', { size: 9.5, color: COLORS.muted });
  doc.space(10);
  doc.signatures([
    { role: 'Landlord', name: v.landlord_name },
    { role: `Agent, for ${agency}`, name: v.agent_name },
    { role: 'Tenant (acknowledgement)', name: v.tenant_name },
  ]);

  return doc.finish();
}

import { handleRequest } from '../server.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  return handleRequest(req, res);
}


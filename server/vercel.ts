import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle } from './app.js';

/** Vercel serverless entry (bundled by scripts/build-vercel.mjs into .vercel/output/functions/api.func). */
export default async function handler(req: IncomingMessage, res: ServerResponse) { await handle(req, res); }

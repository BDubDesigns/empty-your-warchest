import { checkLogExport, uploadCode, uploadKey } from '../../src/core/logUpload';
import { loadLogUploadData } from '../../src/data/logUpload';

// POST /api/logs: Debug → Send logs (and the stress test's Send results) posts the phone's log
// export here, and it's kept in the LOGS KV namespace (bound on the Pages project in Cloudflare's
// dashboard, for preview and production) until it expires. It answers with a short code to quote.
// There's deliberately no way to read a log back through here: they're read with the Cloudflare
// API and Brandon's token.

/** The little of Cloudflare's KV binding this uses (no @cloudflare/workers-types for one call). */
interface LogStore {
  put(
    key: string,
    value: string,
    options: { expirationTtl: number; metadata: Record<string, unknown> },
  ): Promise<void>;
}

export interface Env {
  LOGS: LogStore;
}

interface Context {
  request: Request;
  env: Env;
}

const DAY_S = 24 * 60 * 60;
const data = loadLogUploadData();

const reply = (
  body: Record<string, unknown>,
  status: number,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

/** The body as text, or undefined once it goes over `maxBytes` (it stops reading there). */
async function readCapped(request: Request, maxBytes: number): Promise<string | undefined> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(bytes);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  return new TextDecoder().decode(all);
}

export async function onRequest({ request, env }: Context): Promise<Response> {
  if (request.method !== 'POST') return reply({ error: 'POST only' }, 405, { allow: 'POST' });
  const tooBig = { error: `Logs over ${String(data.maxBytes)} bytes aren't taken` };
  const declared = Number(request.headers.get('content-length'));
  if (declared > data.maxBytes) return reply(tooBig, 413);
  const text = await readCapped(request, data.maxBytes);
  if (text === undefined) return reply(tooBig, 413);
  const checked = checkLogExport(text, data.maxBytes);
  if (!checked.ok) return reply({ error: checked.error }, checked.status);

  const code = uploadCode(crypto.getRandomValues(new Uint8Array(data.codeLength)), data.codeLength);
  const key = uploadKey(new Date(), checked.log.build, code, data.branchChars);
  await env.LOGS.put(key, text, {
    expirationTtl: data.keepDays * DAY_S,
    metadata: { build: checked.log.build, events: checked.log.events.length, bytes: checked.bytes },
  });
  return reply({ code, key }, 200);
}

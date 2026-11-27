import type { LogEvent } from '../core';
import { byteLength, logExportJson } from '../core/logUpload';
import { loadLogUploadData } from '../data/logUpload';

// Debug → Send logs and the stress test's Send results: the log export, posted to /api/logs
// (functions/api/logs.ts), which keeps it for us to read and answers with a short code. Share
// logs… stays as the way out when this can't reach the server.

export type SendResult =
  { ok: true; code: string; bytes: number } | { ok: false; error: string; bytes: number };

const limits = loadLogUploadData();

/** Posts `events` as a log export; never throws. */
export async function sendLogs(events: readonly LogEvent[], build: string): Promise<SendResult> {
  const body = logExportJson(events, build, new Date());
  const bytes = byteLength(body);
  if (bytes > limits.maxBytes) {
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    return { ok: false, error: `the log is ${mb} MB, over the limit`, bytes };
  }
  try {
    const response = await fetch('/api/logs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    const answer = (await response.json().catch(() => ({}))) as { code?: unknown; error?: unknown };
    if (response.ok && typeof answer.code === 'string')
      return { ok: true, code: answer.code, bytes };
    const why = typeof answer.error === 'string' ? `: ${answer.error}` : '';
    return { ok: false, error: `the server said ${String(response.status)}${why}`, bytes };
  } catch (error) {
    return { ok: false, error: `no connection (${String(error)})`, bytes };
  }
}

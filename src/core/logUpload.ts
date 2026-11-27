// Sending the playtest log to /api/logs: what the phone sends, and how the endpoint checks it and
// names it. Pure, so the phone, the Pages Function (functions/api/logs.ts) and the tests share it.

/** A log export, as Debug → Share logs saves it and Send logs posts it. */
export interface LogExport {
  exportedAt: string;
  build: string;
  events: unknown[];
}

/** The export's JSON: the same as the saved file's, without the indenting (it's a third smaller). */
export function logExportJson(events: readonly unknown[], build: string, now: Date): string {
  const body: LogExport = { exportedAt: now.toISOString(), build, events: [...events] };
  return JSON.stringify(body);
}

/** Bytes `text` takes as UTF-8. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export type LogCheck =
  { ok: true; log: LogExport; bytes: number } | { ok: false; status: 400 | 413; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether `text` is a log export of at most `maxBytes`, and what it holds. */
export function checkLogExport(text: string, maxBytes: number): LogCheck {
  const bytes = byteLength(text);
  if (bytes > maxBytes) {
    return { ok: false, status: 413, error: `Over ${String(maxBytes)} bytes` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, status: 400, error: 'Not JSON' };
  }
  if (!isRecord(parsed)) return { ok: false, status: 400, error: 'Not a log export' };
  const { exportedAt, build, events } = parsed;
  if (typeof exportedAt !== 'string' || Number.isNaN(Date.parse(exportedAt))) {
    return { ok: false, status: 400, error: 'exportedAt must be a date string' };
  }
  if (typeof build !== 'string' || build.length === 0) {
    return { ok: false, status: 400, error: 'build must be a string' };
  }
  if (!Array.isArray(events)) return { ok: false, status: 400, error: 'events must be an array' };
  return { ok: true, log: { exportedAt, build, events: events as unknown[] }, bytes };
}

/** No 0/O or 1/I/L, so a code read off a phone screen can't be misread. */
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A short code from `random` bytes (one a character), as shown on the phone after sending. */
export function uploadCode(random: Uint8Array, length: number): string {
  let code = '';
  for (let index = 0; index < length; index++) {
    code += CODE_LETTERS[(random[index] ?? 0) % CODE_LETTERS.length] ?? 'A';
  }
  return code;
}

/**
 * Where an upload is kept: "20261127-134800-bench-K7QX", the time (UTC) first so keys list in
 * order, then the build's branch (from "bench @ 08074ec"), cleaned and cut to `branchChars`.
 */
export function uploadKey(now: Date, build: string, code: string, branchChars: number): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  const branch =
    (build.split(' @ ')[0] ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, branchChars)
      .replace(/-+$/, '') || 'unknown';
  return `${stamp}-${branch}-${code}`;
}

import { z } from 'zod';

// Debug → Send logs: the phone posts its log export to /api/logs (a Cloudflare Pages Function,
// functions/api/logs.ts), which keeps it in the LOGS KV namespace for a while. Not part of the
// game's data: the function reads it on its own, and the debug menu checks the size before sending.

export const logUploadShape = z.object({
  /** The biggest export the endpoint takes (bytes of JSON). */
  maxBytes: z.number().int().positive(),
  /** How long an upload is kept before KV deletes it (days). */
  keepDays: z.number().int().positive(),
  /** Characters in the short code shown on the phone (and at the end of the key). */
  codeLength: z.number().int().min(4),
  /** The most characters of the build's branch name kept in the key. */
  branchChars: z.number().int().positive(),
});

export type LogUploadData = z.output<typeof logUploadShape>;

export const logUpload = {
  // Guesses: a few days of play exports well under 1 MB; KV takes values up to 25 MB.
  maxBytes: 2 * 1024 * 1024,
  keepDays: 90,
  codeLength: 4,
  branchChars: 40,
} satisfies z.input<typeof logUploadShape>;

/** The validated upload data. Throws if anything above is wrong. */
export function loadLogUploadData(raw: unknown = logUpload): LogUploadData {
  const result = logUploadShape.safeParse(raw);
  if (!result.success) {
    throw new Error(`Log upload data is invalid:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

import { describe, expect, it } from 'vitest';
import { onRequest, type Env } from '../functions/api/logs';
import {
  byteLength,
  checkLogExport,
  logExportJson,
  uploadCode,
  uploadKey,
} from '../src/core/logUpload';
import { loadLogUploadData, logUpload } from '../src/data/logUpload';

const limits = loadLogUploadData();
const now = new Date('2026-11-27T13:48:05.123Z');
const events = [{ seq: 0, t: 1, session: 's', type: 'session.start' }];

describe('log upload rules', () => {
  it('has valid data, and rejects bad data loudly', () => {
    expect(limits.maxBytes).toBe(2 * 1024 * 1024);
    expect(() => loadLogUploadData({ ...logUpload, keepDays: 0 })).toThrow(/keepDays/);
  });

  it('takes a log export as the debug menu makes it', () => {
    const json = logExportJson(events, 'bench @ 08074ec', now);
    const checked = checkLogExport(json, limits.maxBytes);
    expect(checked).toEqual({
      ok: true,
      log: { exportedAt: now.toISOString(), build: 'bench @ 08074ec', events },
      bytes: byteLength(json),
    });
  });

  it('rejects anything else, and anything too big', () => {
    const bad = (text: string) => checkLogExport(text, limits.maxBytes);
    expect(bad('not json')).toMatchObject({ ok: false, status: 400 });
    expect(bad('[]')).toMatchObject({ ok: false, status: 400 });
    expect(bad('{"exportedAt":"x","build":"b","events":[]}')).toMatchObject({ status: 400 });
    expect(bad(`{"exportedAt":"${now.toISOString()}","build":"","events":[]}`)).toMatchObject({
      status: 400,
    });
    expect(bad(`{"exportedAt":"${now.toISOString()}","build":"b","events":{}}`)).toMatchObject({
      status: 400,
    });
    const json = logExportJson(events, 'b', now);
    expect(checkLogExport(json, byteLength(json) - 1)).toMatchObject({ ok: false, status: 413 });
    // Counted in bytes, not characters.
    expect(byteLength('✓')).toBe(3);
  });

  it('makes short codes that read unambiguously off a phone screen', () => {
    const code = uploadCode(new Uint8Array([0, 1, 30, 31, 255]), 4);
    expect(code).toHaveLength(4);
    expect(code).toBe('AB9A');
    expect(
      uploadCode(
        new Uint8Array(256).map((_, index) => index),
        256,
      ),
    ).not.toMatch(/[01OIL]/);
  });

  it('names uploads so they list in time order, by branch', () => {
    expect(uploadKey(now, 'bench @ 08074ec', 'K7QX', 40)).toBe('20261127-134805-bench-K7QX');
    expect(uploadKey(now, 'feature/New Thing! @ abc', 'K7QX', 40)).toBe(
      '20261127-134805-feature-new-thing-K7QX',
    );
    expect(uploadKey(now, 'a-very-long-branch-name', 'K7QX', 7)).toBe(
      '20261127-134805-a-very-K7QX',
    );
    expect(uploadKey(now, '@@@', 'K7QX', 40)).toBe('20261127-134805-unknown-K7QX');
  });
});

describe('POST /api/logs', () => {
  const store = () => {
    const puts: { key: string; value: string; options: unknown }[] = [];
    const env: Env = {
      LOGS: {
        put(key, value, options) {
          puts.push({ key, value, options });
          return Promise.resolve();
        },
      },
    };
    return { env, puts };
  };
  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request('https://example.test/api/logs', { method: 'POST', body, headers });

  it('keeps a log export for 90 days and answers with its code', async () => {
    const { env, puts } = store();
    const json = logExportJson(events, 'bench @ 08074ec', now);
    const response = await onRequest({ request: post(json), env });
    expect(response.status).toBe(200);
    const answer = (await response.json()) as { code: string; key: string };
    expect(answer.code).toMatch(/^[A-Z2-9]{4}$/);
    expect(answer.key).toMatch(new RegExp(`^\\d{8}-\\d{6}-bench-${answer.code}$`));
    expect(puts).toEqual([
      {
        key: answer.key,
        value: json,
        options: {
          expirationTtl: 90 * 24 * 60 * 60,
          metadata: { build: 'bench @ 08074ec', events: 1, bytes: byteLength(json) },
        },
      },
    ]);
  });

  it('takes only POSTs of log exports under the cap', async () => {
    const { env, puts } = store();
    const get = await onRequest({ request: new Request('https://example.test/api/logs'), env });
    expect(get.status).toBe(405);
    expect((await onRequest({ request: post('{"nope":1}'), env })).status).toBe(400);
    const big = 'x'.repeat(limits.maxBytes + 1);
    expect((await onRequest({ request: post(big), env })).status).toBe(413);
    // A declared length over the cap is turned away before reading.
    const declared = post('{}', { 'content-length': String(limits.maxBytes + 1) });
    expect((await onRequest({ request: declared, env })).status).toBe(413);
    expect(puts).toEqual([]);
  });
});

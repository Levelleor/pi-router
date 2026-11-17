import { describe, expect, it, vi } from 'vitest';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
import {
  antigravityQuotaResetSeconds,
  isAntigravityQuotaBanner,
  isPotentialAntigravityQuotaBanner,
} from '../core/antigravity-quota.js';
import { structuredFailure, classifyFailure } from '../core/failure-classifier.js';
import { relayProviderStream } from '../core/stream-relay.js';

const NOTICE = '⚠ Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 153h38m14s.';

function streamText(text: string, chunkSize = 4) {
  const stream = createAssistantMessageEventStream();
  const message: any = {
    role: 'assistant', api: 'test-api', provider: 'antigravity', model: 'gemini-test',
    content: [{ type: 'text', text }],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop', timestamp: Date.now(),
  };
  queueMicrotask(() => {
    stream.push({ type: 'start', partial: message } as any);
    stream.push({ type: 'text_start', contentIndex: 0, partial: message } as any);
    for (let i = 0; i < text.length; i += chunkSize)
      stream.push({ type: 'text_delta', contentIndex: 0, delta: text.slice(i, i + chunkSize), partial: message } as any);
    stream.push({ type: 'text_end', contentIndex: 0, content: text, partial: message } as any);
    stream.push({ type: 'done', reason: 'stop', message } as any);
    stream.end();
  });
  return stream;
}

describe('Antigravity quota text failover', () => {
  it('recognises the provider banner and extracts the exact reset interval', () => {
    expect(isAntigravityQuotaBanner(NOTICE)).toBe(true);
    expect(isAntigravityQuotaBanner(NOTICE.replace('⚠ ', '⚠️ '))).toBe(true);
    expect(isPotentialAntigravityQuotaBanner('⚠ Individual q')).toBe(true);
    expect(isPotentialAntigravityQuotaBanner('⚠ Service maintenance')).toBe(false);
    expect(isAntigravityQuotaBanner('The user quoted: ' + NOTICE)).toBe(false);
    expect(isAntigravityQuotaBanner('⚠ Individual quota reached.', true)).toBe(true);
    expect(antigravityQuotaResetSeconds(NOTICE)).toBe(153 * 3600 + 38 * 60 + 14);
    expect(classifyFailure(NOTICE)).toMatchObject({ kind: 'quota-exhausted', retryable: false });
    const start = Date.UTC(2026, 10, 17);
    expect(structuredFailure(new Error(NOTICE), start)).toMatchObject({
      kind: 'quota-exhausted',
      retryAt: start + (153 * 3600 + 38 * 60 + 14) * 1000,
    });
  });

  it('turns streamed quota text into an uncommitted provider failure', async () => {
    const output = createAssistantMessageEventStream();
    const commit = vi.fn();
    const result = await relayProviderStream(streamText(NOTICE, 3), output, undefined, 2000, commit, 'antigravity');
    expect(result).toMatchObject({
      ok: false, aborted: false, committed: false, details: { kind: 'quota-exhausted', retryable: false },
    });
    expect((result as any).error).toContain('153h38m14s');
    expect(commit).not.toHaveBeenCalled();
  });

  it('does not interfere with ordinary Antigravity streaming, including unrelated warnings', async () => {
    for (const normal of ['Hello from Gemini.', '⚠ This request is expensive.']) {
      const output = createAssistantMessageEventStream();
      const commit = vi.fn();
      const result = await relayProviderStream(streamText(normal, 1), output, undefined, 2000, commit, 'antigravity');
      output.end();
      const observed: any[] = [];
      for await (const event of output) observed.push(event);
      expect(result).toEqual({ ok: true });
      expect(commit).toHaveBeenCalledTimes(1);
      expect(observed.filter(event => event.type === 'text_delta').map(event => event.delta).join('')).toBe(normal);
      expect(observed.at(-1)?.type).toBe('done');
    }
  });

  it('does not interpret identical text from other providers as Antigravity quota', async () => {
    const commit = vi.fn();
    const output = createAssistantMessageEventStream();
    const result = await relayProviderStream(streamText(NOTICE), output, undefined, 2000, commit, 'google');
    expect(result).toEqual({ ok: true });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('does not fail over after legitimate text is already committed', async () => {
    const text = 'A legitimate answer. ' + NOTICE;
    const commit = vi.fn();
    const output = createAssistantMessageEventStream();
    const result = await relayProviderStream(streamText(text), output, undefined, 2000, commit, 'antigravity');
    expect(result).toEqual({ ok: true });
    expect(commit).toHaveBeenCalledTimes(1);
  });
});

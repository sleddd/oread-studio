/**
 * Cloudflare Workers AI adapter.
 *
 * Covers the two things that actually bit: a request body missing `max_tokens`
 * (Workers AI defaults to 256, truncating prose), and raw Cloudflare error
 * envelopes being shown to the author verbatim.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CloudflareAdapter, extractText, stripThinking } from './cloudflare.js';
import { ProviderError } from '../provider.js';

const auth = { secret: 'tok', accountId: 'acct' };
const req = {
  model: '@cf/meta/llama-3.1-8b-instruct',
  system: 'You are terse.',
  messages: [{ role: 'user' as const, content: 'Hello' }],
  temperature: 0.85,
  maxTokens: 2048,
};

/** Run generate() against a stubbed fetch and hand back the captured request. */
async function capture(
  response: { ok: boolean; status: number; body: unknown },
  overrides: Partial<typeof req> = {},
): Promise<{ sent: Record<string, unknown>; error: ProviderError | null }> {
  const original = globalThis.fetch;
  let sent: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    sent = JSON.parse(init.body) as Record<string, unknown>;
    return {
      ok: response.ok,
      status: response.status,
      text: async () => JSON.stringify(response.body),
      json: async () => response.body,
    };
  }) as unknown as typeof fetch;
  try {
    await new CloudflareAdapter().generate({ ...req, ...overrides }, auth);
    return { sent, error: null };
  } catch (e) {
    return { sent, error: e as ProviderError };
  } finally {
    globalThis.fetch = original;
  }
}

test('max_tokens is sent — Workers AI otherwise truncates at 256', async () => {
  const { sent } = await capture({ ok: true, status: 200, body: { result: { response: 'hi' } } });
  assert.equal(sent.max_tokens, 2048, 'must not rely on the 256 default');
});

test('temperature is clamped to the documented 0–5 range', async () => {
  const hot = await capture(
    { ok: true, status: 200, body: { result: { response: 'hi' } } },
    { temperature: 9 },
  );
  assert.equal(hot.sent.temperature, 5);
});

test('an empty system prompt is omitted rather than sent blank', async () => {
  const { sent } = await capture(
    { ok: true, status: 200, body: { result: { response: 'hi' } } },
    { system: '   ' },
  );
  const msgs = sent.messages as { role: string }[];
  assert.equal(msgs.length, 1, 'only the user turn');
  assert.equal(msgs[0]!.role, 'user');
});

test('a system prompt IS sent when present', async () => {
  const { sent } = await capture({ ok: true, status: 200, body: { result: { response: 'hi' } } });
  const msgs = sent.messages as { role: string }[];
  assert.equal(msgs[0]!.role, 'system');
});

test('the reported 3030 AiError is explained as an upstream failure', async () => {
  // The exact envelope the author saw.
  const { error } = await capture({
    ok: false,
    status: 400,
    body: {
      errors: [{ message: 'AiError: AiError: Internal Server Error (37f10e29)', code: 3030 }],
      success: false,
      result: {},
      messages: [],
    },
  });
  assert.ok(error);
  assert.match(error.message, /not a problem with your request/);
  assert.match(error.message, /retry, or choose a different model/);
  assert.match(error.message, /llama-3\.1-8b-instruct/, 'names the model');
  assert.doesNotMatch(error.message, /\{"errors"/, 'raw JSON is not dumped at the author');
});

test('documented error codes get their documented meaning', async () => {
  const quota = await capture({
    ok: false,
    status: 429,
    body: { errors: [{ code: 3036, message: 'x' }] },
  });
  assert.match(quota.error!.message, /daily free Workers AI allocation/);

  const capacity = await capture({
    ok: false,
    status: 429,
    body: { errors: [{ code: 3040, message: 'x' }] },
  });
  assert.match(capacity.error!.message, /no capacity/);

  const missing = await capture({
    ok: false,
    status: 400,
    body: { errors: [{ code: 5007, message: 'x' }] },
  });
  assert.match(missing.error!.message, /no model named/);
});

test('HTTP 200 with success:false is still treated as a failure', async () => {
  // Workers AI does this — the status code alone is not a reliable signal.
  const { error } = await capture({
    ok: true,
    status: 200,
    body: { success: false, errors: [{ code: 3030, message: 'AiError: Internal Server Error' }], result: {} },
  });
  assert.ok(error, 'must not return an empty completion as success');
  assert.match(error.message, /not a problem with your request/);
});

// ── response shapes: Workers AI is not consistent across models ──

test('extractText reads every shape Workers AI actually returns', () => {
  // Classic.
  assert.equal(extractText({ response: 'hello' }), 'hello');
  // OpenAI-compatible streaming delta (Gemma 4 and other newer models).
  assert.equal(extractText({ choices: [{ delta: { content: 'hi' } }] }), 'hi');
  // OpenAI-compatible non-streaming.
  assert.equal(extractText({ choices: [{ message: { content: 'hi' } }] }), 'hi');
  // Completion-style.
  assert.equal(extractText({ choices: [{ text: 'hi' }] }), 'hi');
  // Nested under result.
  assert.equal(extractText({ result: { response: 'hi' } }), 'hi');
  // Nothing usable.
  assert.equal(extractText({ usage: { tokens: 3 } }), '');
});

test('reasoning scratchpad is stripped, not shown as prose', () => {
  assert.equal(stripThinking('<think>weighing it</think>The answer.'), 'The answer.');
  assert.equal(stripThinking('<thinking>hmm</thinking>\n\nThe answer.'), 'The answer.');
  // Unterminated: everything after the open tag is scratchpad.
  assert.equal(stripThinking('The answer.<think>still musing'), 'The answer.');
  assert.equal(stripThinking('Plain prose.'), 'Plain prose.');
});

test('a Gemma-style OpenAI-shaped reply is no longer read as empty', async () => {
  // This is the regression: gemma-4 returned choices[].message.content, the
  // parser only read `response`, and the author got "returned nothing".
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({
      success: true,
      result: { choices: [{ message: { content: 'The rain kept on.' } }] },
    }),
  })) as unknown as typeof fetch;
  try {
    const out = await new CloudflareAdapter().generate(
      { ...req, model: '@cf/google/gemma-4-26b-a4b-it' },
      auth,
    );
    assert.equal(out.text, 'The rain kept on.');
  } finally {
    globalThis.fetch = original;
  }
});

test('a non-JSON error body still produces a readable message', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: false,
    status: 502,
    text: async () => '<html>Bad Gateway</html>',
    json: async () => ({}),
  })) as unknown as typeof fetch;
  try {
    await new CloudflareAdapter().generate(req, auth);
    assert.fail('should have thrown');
  } catch (e) {
    assert.match((e as Error).message, /502/);
  } finally {
    globalThis.fetch = original;
  }
});

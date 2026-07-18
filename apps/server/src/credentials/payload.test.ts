import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

before(() => {
  process.env.MASTER_KEY_V1 = randomBytes(32).toString('base64');
  process.env.MASTER_KEY_ACTIVE_VER = '1';
});

// The credentials store packs {secret, accountId, region, baseUrl} as JSON into
// the sealed plaintext. This verifies that packing round-trips through the
// envelope — the same code path resolveAuth relies on, without a DB.
test('multi-field provider auth round-trips through the envelope', async () => {
  const { seal, open } = await import('../crypto/envelope.js');
  const payload = {
    secret: 'cf-token-xyz',
    accountId: 'acct_123',
    region: undefined as string | undefined,
    baseUrl: undefined as string | undefined,
  };
  const rec = seal(JSON.stringify(payload));
  const back = JSON.parse(open(rec));
  assert.equal(back.secret, 'cf-token-xyz');
  assert.equal(back.accountId, 'acct_123');
});

test('every provider has a registered adapter', async () => {
  const { getAdapter } = await import('../ai/adapters/index.js');
  for (const p of ['anthropic', 'openai', 'bedrock', 'cloudflare', 'local'] as const) {
    const a = getAdapter(p);
    assert.equal(a.provider, p);
    assert.equal(typeof a.generate, 'function');
    assert.equal(typeof a.stream, 'function');
  }
});

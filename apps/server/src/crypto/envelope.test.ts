import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

// Set master keys BEFORE importing the module (env reads at call time, so this
// is fine, but set here to be explicit and deterministic).
before(() => {
  process.env.MASTER_KEY_V1 = randomBytes(32).toString('base64');
  process.env.MASTER_KEY_V2 = randomBytes(32).toString('base64');
  process.env.MASTER_KEY_ACTIVE_VER = '1';
});

test('seal/open round-trips arbitrary strings', async () => {
  const { seal, open } = await import('./envelope.js');
  for (const secret of ['sk-ant-abc123', '', 'unicode: 🔐 café', 'x'.repeat(5000)]) {
    const rec = seal(secret);
    assert.equal(open(rec), secret);
  }
});

test('ciphertext is not the plaintext and each seal is unique', async () => {
  const { seal, open } = await import('./envelope.js');
  const secret = 'sk-ant-super-secret';
  const a = seal(secret);
  const b = seal(secret);
  assert.notEqual(a.ciphertext.toString('hex'), Buffer.from(secret).toString('hex'));
  // distinct DEKs/IVs → distinct ciphertext for the same plaintext
  assert.notEqual(a.ciphertext.toString('hex'), b.ciphertext.toString('hex'));
  assert.equal(open(a), secret);
  assert.equal(open(b), secret);
});

test('tampered ciphertext fails authentication', async () => {
  const { seal, open } = await import('./envelope.js');
  const rec = seal('tamper-me');
  rec.ciphertext[0] = (rec.ciphertext[0]! ^ 0xff) & 0xff;
  assert.throws(() => open(rec));
});

test('rotation: item sealed under active version records that version', async () => {
  const { seal } = await import('./envelope.js');
  process.env.MASTER_KEY_ACTIVE_VER = '2';
  const rec = seal('rotated');
  assert.equal(rec.masterKeyVer, 2);
  process.env.MASTER_KEY_ACTIVE_VER = '1';
});

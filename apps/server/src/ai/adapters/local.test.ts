import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalAdapter } from './local.js';
import { ProviderError } from '../provider.js';

const adapter = new LocalAdapter();
const req = {
  system: 's',
  messages: [{ role: 'user' as const, content: 'hi' }],
  model: 'm',
  temperature: 0,
};

// A user-supplied baseUrl targeting an internal host must be rejected in base()
// BEFORE any outbound fetch happens (SSRF guard). Each blocked case throws a
// 400 ProviderError synchronously, so no network mock is needed.
const BLOCKED = [
  'http://169.254.169.254/latest/meta-data/', // cloud metadata
  'http://127.0.0.1:11434',
  'http://localhost:11434',
  'http://10.0.0.5:11434',
  'http://192.168.1.10',
  'http://172.16.0.1',
  'http://[::1]:11434',
  'file:///etc/passwd', // non-http(s) protocol
  'gopher://internal', // non-http(s) protocol
  'not a url', // unparseable
];

for (const url of BLOCKED) {
  test(`local adapter rejects SSRF/invalid baseUrl: ${url}`, async () => {
    await assert.rejects(
      () => adapter.listModels({ baseUrl: url }),
      (e: unknown) => e instanceof ProviderError && e.status === 400,
      `expected ${url} to be rejected before fetch`,
    );
    await assert.rejects(
      () => adapter.generate(req, { baseUrl: url }),
      (e: unknown) => e instanceof ProviderError && e.status === 400,
    );
  });
}

test('local adapter accepts a public host (passes the guard, fails only at fetch)', async () => {
  // A public DNS host clears the SSRF guard; the call then fails at the network
  // layer, which is a non-ProviderError(400) — proving the guard let it through.
  await assert.rejects(
    () => adapter.listModels({ baseUrl: 'http://ollama.example.com:11434' }),
    (e: unknown) => !(e instanceof ProviderError && e.status === 400),
  );
});

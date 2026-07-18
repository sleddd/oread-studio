import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

before(() => {
  process.env.SESSION_SECRET = randomBytes(24).toString('base64');
});

test('app boots and health check responds without a DB', async () => {
  const { buildApp } = await import('./app.js');
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.ok(['postgres', 'local'].includes(body.storage));
  } finally {
    await app.close();
  }
});

test('unauthenticated /api/auth/me returns 401', async () => {
  const { buildApp } = await import('./app.js');
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    assert.equal(res.statusCode, 401);
  } finally {
    await app.close();
  }
});

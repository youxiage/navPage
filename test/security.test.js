import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';

Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
globalThis.btoa ??= (value) => Buffer.from(value, 'binary').toString('base64');
globalThis.atob ??= (value) => Buffer.from(value, 'base64').toString('binary');

const { createSessionToken, normalizeHttpUrl, secretsEqual, verifySessionToken } = await import('../src/security.js');

test('session tokens verify with the correct HMAC secret', async () => {
  const token = await createSessionToken('a-long-test-secret');
  assert.equal(await verifySessionToken(token, 'a-long-test-secret'), true);
  assert.equal(await verifySessionToken(token, 'another-secret'), false);
});

test('tampered session tokens are rejected', async () => {
  const token = await createSessionToken('a-long-test-secret');
  const parts = token.split('.');
  parts[1] = `${parts[1].slice(0, -1)}${parts[1].endsWith('A') ? 'B' : 'A'}`;
  assert.equal(await verifySessionToken(parts.join('.'), 'a-long-test-secret'), false);
});

test('secret comparison matches only equal values', async () => {
  assert.equal(await secretsEqual('same', 'same'), true);
  assert.equal(await secretsEqual('same', 'different'), false);
});

test('URL validation rejects unsafe targets', () => {
  assert.equal(normalizeHttpUrl('https://example.com/path'), 'https://example.com/path');
  assert.throws(() => normalizeHttpUrl('javascript:alert(1)'));
  assert.throws(() => normalizeHttpUrl('http://127.0.0.1/admin', { blockPrivate: true }));
  assert.throws(() => normalizeHttpUrl('http://192.168.1.1/', { blockPrivate: true }));
});

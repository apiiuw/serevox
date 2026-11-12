import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createSerevoxClient, verifySerevoxWebhook } from '../dist/index.js';

test('getPublicUrl builds clean CDN and transform URLs', () => {
  const client = createSerevoxClient({ url: 'https://storage.example.com/', apiKey: 'srx_anon_123' });
  const plain = client.from('media').getPublicUrl('/avatars/user 1.png');
  assert.equal(plain, 'https://storage.example.com/v1/public/media/avatars/user%201.png');

  const transformed = client.from('media').getPublicUrl('hero.jpg', {
    transform: { width: 400, height: 300, fit: 'cover', quality: 85, format: 'jpeg' },
  });
  assert.equal(
    transformed,
    'https://storage.example.com/v1/public/media/hero.jpg?w=400&h=300&fit=cover&q=85&format=jpeg'
  );
});

test('upload sends Authorization header and path query', async () => {
  let capturedUrl = '';
  let capturedAuth = '';
  const mockFetch = async (url, init) => {
    capturedUrl = String(url);
    capturedAuth = init.headers['Authorization'];
    return new Response(JSON.stringify({ bucket: 'assets', object: { key: 'logo.png', size_bytes: 3 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const client = createSerevoxClient({ url: 'http://localhost:8080', apiKey: 'srx_srv_secret', fetch: mockFetch });
  const res = await client.from('assets').upload('logo.png', new Uint8Array([1, 2, 3]), { upsert: true });

  assert.equal(res.error, null);
  assert.equal(res.data.object.key, 'logo.png');
  assert.equal(capturedUrl, 'http://localhost:8080/v1/buckets/assets/objects/upload?path=logo.png&upsert=true');
  assert.equal(capturedAuth, 'Bearer srx_srv_secret');
});

test('verifySerevoxWebhook validates HMAC-SHA256 signatures and rejects tampering', async () => {
  const secret = 'whsec_test_secret';
  const payload = JSON.stringify({ event: 'object.uploaded', data: { key: 'a.png' } });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');

  assert.equal(await verifySerevoxWebhook(payload, sig, ts, secret), true);
  assert.equal(await verifySerevoxWebhook(payload + ' ', sig, ts, secret), false);
  assert.equal(await verifySerevoxWebhook(payload, sig, '1000', secret), false);
});


import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';

const valid = { name: 'Élodie', email: 'test@example.com', market: 'Forex', style: 'Swing', consent: true, website: '' };
async function boot(options = {}) { const server = createApp({ databasePath: ':memory:', ...options }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`; return { server, origin, post: (body, headers = {}) => fetch(`${origin}/api/waitlist`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }) }; }
async function stop(server) { await new Promise(resolve => server.close(resolve)); }

test('signup, private session, reload persistence, duplicate safety and permanent withdrawal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'manuel-')); const databasePath = join(dir, 'waitlist.sqlite');
  let app = await boot({ databasePath });
  try {
    const response = await app.post(valid); assert.equal(response.status, 201);
    const data = await response.json(); assert.equal(data.member.name, 'Élodie'); assert.equal(data.member.id, 1); assert.equal(data.member.email, undefined);
    const cookie = response.headers.get('set-cookie'); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
    const sessionCookie = cookie.split(';')[0];
    assert.equal((await fetch(`${app.origin}/api/member/card`)).status, 401);
    const card = await fetch(`${app.origin}/api/member/card`, { headers: { Cookie: sessionCookie } });
    assert.equal(card.status, 200); assert.match(card.headers.get('content-disposition'), /attachment/); assert.match(await card.text(), /Élodie/);
    assert.equal((await fetch(`${app.origin}/api/member`)).status, 401);
    const duplicate = await app.post({ ...valid, email: 'TEST@example.com', name: 'Different' }); assert.equal(duplicate.status, 200); assert.equal((await duplicate.json()).member, undefined); assert.equal(duplicate.headers.get('set-cookie'), null);
    await stop(app.server); app = await boot({ databasePath });
    const session = await fetch(`${app.origin}/api/member`, { headers: { Cookie: sessionCookie } }); assert.equal(session.status, 200); assert.equal((await session.json()).member.name, 'Élodie');
    const removed = await fetch(`${app.origin}/api/member`, { method: 'DELETE', headers: { Origin: app.origin, Cookie: sessionCookie } }); assert.equal(removed.status, 200); assert.match(removed.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await fetch(`${app.origin}/api/member`, { headers: { Cookie: sessionCookie } })).status, 401);
    assert.equal((await app.post(valid)).status, 201);
  } finally { await stop(app.server); await rm(dir, { recursive: true, force: true }); }
});

test('rejects invalid input, missing consent, cross-origin requests and oversized bodies', async () => {
  const app = await boot();
  try {
    for (const value of [null, [], { ...valid, name: '<script>' }, { ...valid, email: 'invalid' }, { ...valid, consent: false }, { ...valid, market: 'Invalid' }, { ...valid, style: 'Invalid' }, { ...valid, website: 'bot' }]) assert.equal((await app.post(value)).status, 400);
    assert.equal((await app.post(valid, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await app.post(valid, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await app.post({ ...valid, name: 'A'.repeat(5000) })).status, 413);
    const home = await fetch(app.origin); assert.equal(home.status, 200); assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/); assert.match(await home.text(), /Le marché bouge/);
    assert.equal((await fetch(`${app.origin}/data/waitlist.sqlite`)).status, 404);
  } finally { await stop(app.server); }
});

test('session expiry and repeat-attempt throttle', async () => {
  let time = Date.now(); const app = await boot({ clock: () => time });
  try {
    const first = await app.post(valid); const cookie = first.headers.get('set-cookie').split(';')[0];
    for (let i = 0; i < 4; i++) assert.equal((await app.post(valid)).status, 200);
    const throttled = await app.post(valid); assert.equal(throttled.status, 429); assert.equal(throttled.headers.get('retry-after'), '3600');
    time += 91 * 86400000;
    assert.equal((await fetch(`${app.origin}/api/member`, { headers: { Cookie: cookie } })).status, 401);
  } finally { await stop(app.server); }
});

test('production requires HTTPS canonical origin and emits secure session cookies', async () => {
  assert.throws(() => createApp({ databasePath: ':memory:', production: true, publicUrl: '' }), /required/);
  assert.throws(() => createApp({ databasePath: ':memory:', production: true, publicUrl: 'http://example.com' }), /HTTPS/);
  const app = await boot({ production: true, publicUrl: 'https://manuel.example' });
  try { const response = await app.post(valid, { Origin: 'https://manuel.example' }); assert.equal(response.status, 201); assert.match(response.headers.get('set-cookie'), /Secure/); assert.ok(response.headers.get('strict-transport-security')); }
  finally { await stop(app.server); }
});

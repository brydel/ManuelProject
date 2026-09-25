import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCard } from './card.mjs';

export const MARKETS = ['Forex', 'Indices', 'Or & matières premières', 'Crypto'];
export const STYLES = ['Intraday', 'Swing', 'Long terme', 'En exploration'];
const hash = value => createHash('sha256').update(value).digest('hex');
const root = fileURLToPath(new URL('./public/', import.meta.url));
const DAY = 86400;

export function createApp({ databasePath = process.env.DATABASE_PATH || './data/waitlist.sqlite', production = process.env.NODE_ENV === 'production', publicUrl = process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : ''), clock = Date.now } = {}) {
  if (production && !publicUrl) throw new Error('PUBLIC_URL or RAILWAY_PUBLIC_DOMAIN is required in production.');
  const expectedOrigin = publicUrl ? new URL(publicUrl).origin : null;
  if (production && !expectedOrigin.startsWith('https://')) throw new Error('Production PUBLIC_URL must use HTTPS.');
  if (databasePath !== ':memory:') mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE, market TEXT NOT NULL, style TEXT NOT NULL,
      consent_version TEXT NOT NULL, created_at TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL
    );`);
  const limits = new Map();
  const statements = {
    insert: db.prepare('INSERT INTO members (name,email,market,style,consent_version,created_at,token_hash,expires_at) VALUES (?,?,?,?,?,?,?,?)'),
    session: db.prepare('SELECT id,name,market,style,created_at FROM members WHERE token_hash=? AND expires_at>?'),
    delete: db.prepare('DELETE FROM members WHERE token_hash=?'),
  };
  function limited(key, max, windowMs) {
    const now = clock();
    if (limits.size > 5000) for (const [k, v] of limits) if (v.until <= now) limits.delete(k);
    const bucket = limits.get(key);
    if (!bucket || bucket.until <= now) { limits.set(key, { count: 1, until: now + windowMs }); return false; }
    return ++bucket.count > max;
  }
  const cookie = token => `manuel_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? 90 * DAY : 0}${production ? '; Secure' : ''}`;
  function tokenFrom(req) {
    const token = req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith('manuel_session='))?.slice(15);
    return token && /^[a-f0-9]{64}$/.test(token) ? hash(token) : null;
  }
  const member = row => ({ id: row.id, name: row.name, market: row.market, style: row.style, createdAt: row.created_at });
  function json(res, status, body, headers = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(body)); }
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('Format non pris en charge.'), { status: 415 });
    let size = 0; const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 4096) throw Object.assign(new Error('Formulaire trop volumineux.'), { status: 413 });
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString()); }
    catch { throw Object.assign(new Error('Formulaire invalide.'), { status: 400 }); }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/api/health') { db.prepare('SELECT 1').get(); return json(res, 200, { status: 'ok' }); }
      if (req.method === 'GET' && path === '/api/member/card') {
        const token = tokenFrom(req); const row = token && statements.session.get(token, clock());
        if (!row) return json(res, 401, { error: 'Session expirée. Votre carte nécessite la session de votre inscription.' });
        res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Content-Disposition': `attachment; filename="MANUEL-ORIGIN-${String(row.id).padStart(5, '0')}.svg"`, 'Cache-Control': 'no-store' });
        return res.end(renderCard(member(row)));
      }
      if (req.method === 'GET' && path === '/api/member') {
        const token = tokenFrom(req); const row = token && statements.session.get(token, clock());
        return json(res, row ? 200 : 401, row ? { member: member(row) } : { error: 'Aucune session active.' });
      }
      if (['POST', 'DELETE'].includes(req.method)) {
        const origin = req.headers.origin;
        const allowed = expectedOrigin || `http://${req.headers.host}`;
        if (!origin || origin !== allowed || req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'Origine non autorisée.' });
      }
      if (req.method === 'DELETE' && path === '/api/member') {
        const token = tokenFrom(req);
        if (!token || !statements.session.get(token, clock())) return json(res, 401, { error: 'Session expirée.' });
        statements.delete.run(token);
        return json(res, 200, { deleted: true }, { 'Set-Cookie': cookie('') });
      }
      if (req.method === 'POST' && path === '/api/waitlist') {
        // Global ceiling works behind a reverse proxy without trusting client-supplied IP headers.
        if (limited('global', 120, 60000)) return json(res, 429, { error: 'Beaucoup de demandes en ce moment. Réessaie dans une minute.' }, { 'Retry-After': '60' });
        const input = await body(req);
        if (!input || typeof input !== 'object' || Array.isArray(input)) return json(res, 400, { error: 'Formulaire invalide.' });
        const { market, style, consent } = input;
        const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
        const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
        if (input.website) return json(res, 400, { error: 'Impossible de valider cette inscription.' });
        if (name.length < 2 || name.length > 60 || !/^[\p{L}\p{M} .’'\-]+$/u.test(name)) return json(res, 400, { error: 'Indique un prénom valide (2 à 60 caractères).' });
        if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json(res, 400, { error: 'Vérifie ton adresse courriel.' });
        if (!MARKETS.includes(market) || !STYLES.includes(style) || consent !== true) return json(res, 400, { error: 'Complète ton profil et accepte de recevoir ton invitation.' });
        if (limited(`email:${hash(email)}`, 5, 3600000)) return json(res, 429, { error: 'Trop de tentatives pour cette adresse. Réessaie plus tard.' }, { 'Retry-After': '3600' });
        const token = randomBytes(32).toString('hex');
        try { statements.insert.run(name, email, market, style, '2026-09-25-v1', new Date(clock()).toISOString(), hash(token), clock() + 90 * DAY * 1000); }
        catch (error) {
          if (error.code?.startsWith('ERR_SQLITE') && /UNIQUE constraint failed: members.email/.test(error.message)) return json(res, 200, { status: 'received' });
          throw error;
        }
        const row = statements.session.get(hash(token), clock());
        return json(res, 201, { status: 'created', member: member(row) }, { 'Set-Cookie': cookie(token) });
      }
      const files = { '/': ['index.html', 'text/html'], '/styles.css': ['styles.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
      if (['GET', 'HEAD'].includes(req.method) && files[path]) {
        const [file, type] = files[path]; const data = await readFile(resolve(root, file));
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-cache' });
        return res.end(req.method === 'HEAD' ? undefined : data);
      }
      return json(res, 404, { error: 'Page introuvable.' });
    } catch (error) {
      if (!error.status) console.error('Request failed:', error.code || error.name);
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Un problème est survenu. Réessaie dans un instant.' });
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createApp();
  const portFlag = process.argv.indexOf('--port');
  const port = Number(process.env.PORT || (portFlag >= 0 ? process.argv[portFlag + 1] : 3000));
  server.listen(port, '0.0.0.0', () => console.log(`MANUEL listening on port ${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
}

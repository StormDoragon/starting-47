'use strict';

/* End-to-end HTTP test of the admin back-office console against the real app:
   access control (anon → login, non-admin → 403, admin → 200), every admin
   page, the live overview JSON, a client deep-view, and a KYC decision action.
   Runs on an ephemeral port with a throwaway database seeded via seedDemo. */

const path = require('path');
const os = require('os');
process.env.DB_FILE = path.join(os.tmpdir(), `meridian-test-admin-${process.pid}.db`);
process.env.DEMO_SEED = 'false'; // we seed explicitly below

const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../src/config');
const { ensureSeeded } = require('../src/db/seedDemo');
const { createApp } = require('../src/app');
const { db } = require('../src/db');

let server;
let base;

// ---- Cookie jar + form client (mirrors the investor integration test) ------

function makeClient() {
  const jar = new Map();
  function setCookieLines(res) {
    if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie();
    const raw = res.headers.get('set-cookie');
    return raw ? raw.split(/,(?=\s*[^;,\s]+=)/) : [];
  }
  function store(res) {
    for (const line of setCookieLines(res)) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === '') jar.delete(name);
      else jar.set(name, value);
    }
  }
  const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  return {
    jar,
    async get(p) {
      const res = await fetch(base + p, { headers: { cookie: cookieHeader() }, redirect: 'manual' });
      store(res);
      return res;
    },
    async post(p, fields, { csrf = true } = {}) {
      const body = new URLSearchParams(fields);
      if (csrf) body.set('_csrf', jar.get('meridian.csrf') || '');
      const res = await fetch(base + p, {
        method: 'POST',
        headers: { cookie: cookieHeader(), 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        redirect: 'manual',
      });
      store(res);
      return res;
    },
  };
}

async function loginAs(client, email, password) {
  await client.get('/login');
  return client.post('/login', { email, password });
}

test.before(async () => {
  ensureSeeded(); // admin + demo clients with positions, KYC, history
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try {
    db.close();
    for (const s of ['', '-wal', '-shm']) require('fs').rmSync(process.env.DB_FILE + s, { force: true });
  } catch {
    /* best-effort */
  }
});

// ---- Access control --------------------------------------------------------

test('the demo seed produced an admin and client accounts', () => {
  const admin = db.prepare('SELECT * FROM users WHERE email = ?').get(config.admin.email);
  assert.ok(admin, 'admin account exists');
  assert.equal(admin.is_admin, 1, 'admin account is flagged as admin');
  const clients = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 0').get().n;
  assert.ok(clients > 0, 'demo clients exist');
});

test('anonymous access to /admin redirects to login', async () => {
  const client = makeClient();
  const res = await client.get('/admin');
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\/login/);
});

test('a non-admin client is forbidden from the console', async () => {
  const client = makeClient();
  // Any seeded client shares this demo password (see seedDemo.js).
  const login = await loginAs(client, 'liang.wei@example.com', 'Client-Demo-2026!');
  assert.equal(login.status, 302);
  const res = await client.get('/admin');
  assert.equal(res.status, 403);
});

// ---- Admin pages -----------------------------------------------------------

test('admin can reach every console page', async () => {
  const admin = makeClient();
  const login = await loginAs(admin, config.admin.email, config.admin.password);
  assert.equal(login.status, 302);

  const pages = ['/admin', '/admin/clients', '/admin/investments', '/admin/transactions', '/admin/security', '/admin/kyc', '/admin/system'];
  for (const p of pages) {
    const res = await admin.get(p);
    assert.equal(res.status, 200, `${p} should be 200`);
    const html = await res.text();
    assert.match(html, /No real funds are processed/, `${p} keeps the demo disclaimer`);
  }

  const overview = await admin.get('/admin');
  const html = await overview.text();
  assert.match(html, /Assets under management/);
});

test('the live overview API returns platform metrics', async () => {
  const admin = makeClient();
  await loginAs(admin, config.admin.email, config.admin.password);
  const res = await admin.get('/admin/api/overview');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(typeof data.aumCents, 'number');
  assert.ok(data.aumCents > 0, 'seeded positions produce non-zero AUM');
  assert.ok(Array.isArray(data.aumSeries) && data.aumSeries.length > 0, 'AUM time series present');
  assert.ok(Array.isArray(data.poolBreakdown) && data.poolBreakdown.length > 0);
});

test('client search and deep-view load', async () => {
  const admin = makeClient();
  await loginAs(admin, config.admin.email, config.admin.password);

  const search = await admin.get('/admin/clients?q=amara');
  assert.equal(search.status, 200);
  const listHtml = await search.text();
  assert.match(listHtml, /amara\.okafor@example\.com/i);

  const id = (listHtml.match(/\/admin\/clients\/(usr_[a-f0-9]+)/) || [])[1];
  assert.ok(id, 'a client link is present');
  const detail = await admin.get('/admin/clients/' + id);
  assert.equal(detail.status, 200);
  assert.match(await detail.text(), /Positions/);
});

// ---- Actions ---------------------------------------------------------------

test('admin can approve a pending KYC submission', async () => {
  const admin = makeClient();
  await loginAs(admin, config.admin.email, config.admin.password);

  const queue = await admin.get('/admin/kyc');
  const html = await queue.text();
  const sid = (html.match(/\/admin\/kyc\/(kyc_[a-f0-9]+)/) || [])[1];
  assert.ok(sid, 'a pending submission exists to review');

  const before = db.prepare('SELECT status FROM kyc_submissions WHERE id = ?').get(sid).status;
  assert.equal(before, 'pending');

  const res = await admin.post('/admin/kyc/' + sid, { decision: 'approve' });
  assert.equal(res.status, 302);

  const after = db.prepare('SELECT status FROM kyc_submissions WHERE id = ?').get(sid).status;
  assert.equal(after, 'approved');
  const submission = db.prepare('SELECT user_id FROM kyc_submissions WHERE id = ?').get(sid);
  const user = db.prepare('SELECT kyc_status FROM users WHERE id = ?').get(submission.user_id);
  assert.equal(user.kyc_status, 'approved', 'the user record is updated too');
});

test('admin state-changing actions require a CSRF token', async () => {
  const admin = makeClient();
  await loginAs(admin, config.admin.email, config.admin.password);
  const res = await admin.post('/admin/kyc/kyc_does_not_matter', { decision: 'approve' }, { csrf: false });
  assert.equal(res.status, 403);
});

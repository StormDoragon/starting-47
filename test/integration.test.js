'use strict';

/* End-to-end HTTP test of the investor journey against the real app:
   register → simulated KYC → deposit → live portfolio API → early withdrawal
   (penalty + virtual cash credit) → password/2FA/session security flows.
   Runs on an ephemeral port with a throwaway database. */

const path = require('path');
const os = require('os');
process.env.DB_FILE = path.join(os.tmpdir(), `meridian-test-http-${process.pid}.db`);

const test = require('node:test');
const assert = require('node:assert/strict');
const speakeasy = require('speakeasy');

const { createApp } = require('../src/app');
const { client } = require('../src/db');

let server;
let base;

// ---- Minimal cookie jar + form client --------------------------------------

const jar = new Map();

/**
 * Read individual Set-Cookie headers in a way that works across Node 18+.
 * `Headers.getSetCookie()` only exists on newer undici builds; when it's
 * missing we split the comma-joined `set-cookie` value back into cookies —
 * splitting only on a comma that precedes a `name=` pair, so commas inside an
 * `Expires=Wed, 02 Jul ...` attribute don't cause a false split.
 */
function setCookieLines(res) {
  if (typeof res.headers.getSetCookie === 'function') {
    return res.headers.getSetCookie();
  }
  const raw = res.headers.get('set-cookie');
  return raw ? raw.split(/,(?=\s*[^;,\s]+=)/) : [];
}

function storeCookies(res) {
  for (const line of setCookieLines(res)) {
    const [pair] = line.split(';');
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (value === '') jar.delete(name);
    else jar.set(name, value);
  }
}

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function get(pathname) {
  const res = await fetch(base + pathname, {
    headers: { cookie: cookieHeader() },
    redirect: 'manual',
  });
  storeCookies(res);
  return res;
}

async function postForm(pathname, fields, { csrf = true } = {}) {
  const body = new URLSearchParams(fields);
  if (csrf) body.set('_csrf', jar.get('meridian.csrf') || '');
  const res = await fetch(base + pathname, {
    method: 'POST',
    headers: {
      cookie: cookieHeader(),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
    redirect: 'manual',
  });
  storeCookies(res);
  return res;
}

test.before(async () => {
  const app = await createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try {
    client.close();
    require('fs').rmSync(process.env.DB_FILE, { force: true });
    require('fs').rmSync(process.env.DB_FILE + '-wal', { force: true });
    require('fs').rmSync(process.env.DB_FILE + '-shm', { force: true });
  } catch {
    /* best-effort cleanup */
  }
});

// ---- The journey ------------------------------------------------------------

test('marketing pages render with the demo disclaimer', async () => {
  for (const p of ['/', '/how-it-works', '/pools', '/pools/forex', '/security', '/pricing', '/about']) {
    const res = await get(p);
    assert.equal(res.status, 200, p);
    const html = await res.text();
    assert.match(html, /No real funds are processed/, `${p} is missing the disclaimer`);
  }
});

test('unknown routes render the 404 page', async () => {
  const res = await get('/definitely-not-a-page');
  assert.equal(res.status, 404);
});

test('state-changing requests without a CSRF token are rejected', async () => {
  await get('/register');
  const res = await postForm('/register', { email: 'x@example.com' }, { csrf: false });
  assert.equal(res.status, 403);
});

test('registration validates input then signs the user in', async () => {
  await get('/register');
  const bad = await postForm('/register', {
    display_name: 'A',
    email: 'not-an-email',
    password: 'weak',
    confirm: 'weak2',
  });
  assert.equal(bad.status, 422);

  const res = await postForm('/register', {
    display_name: 'Journey Tester',
    email: 'journey@example.com',
    password: 'Str0ng-Passw0rd!',
    confirm: 'Str0ng-Passw0rd!',
  });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\/portal\/onboarding$/);
});

test('portal requires KYC before money flows', async () => {
  const res = await get('/portal');
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\/portal\/onboarding$/);
});

test('KYC rejects minors, approves adults (simulated)', async () => {
  await get('/portal/onboarding');
  const minor = await postForm('/portal/onboarding', {
    full_name: 'Journey Tester',
    dob: new Date(Date.now() - 15 * 365.25 * 86400000).toISOString().slice(0, 10),
    country: 'United Kingdom',
    address: '1 Demo Street, London',
    id_doc_type: 'Passport',
    id_doc_ref: 'demo.jpg',
  });
  assert.equal(minor.status, 422);

  const ok = await postForm('/portal/onboarding', {
    full_name: 'Journey Tester',
    dob: '1990-04-12',
    country: 'United Kingdom',
    address: '1 Demo Street, London',
    id_doc_type: 'Passport',
    id_doc_ref: 'demo.jpg',
  });
  assert.equal(ok.status, 302);
  assert.match(ok.headers.get('location'), /\/portal\/deposit$/);
});

test('deposit enforces the minimum, maximum and amount format', async () => {
  await get('/portal/deposit');
  const under = await postForm('/portal/deposit', { method: 'card', amount_pool_stocks: '100' });
  assert.equal(under.status, 422);
  const over = await postForm('/portal/deposit', { method: 'card', amount_pool_stocks: '2000000' });
  assert.equal(over.status, 422);
  const junk = await postForm('/portal/deposit', { method: 'card', amount_pool_stocks: 'lots' });
  assert.equal(junk.status, 422);
});

test('a valid split deposit opens positions with backfilled history', async () => {
  const res = await postForm('/portal/deposit', {
    method: 'bank',
    amount_pool_stocks: '400',
    amount_pool_forex: '300',
    amount_pool_realestate: '0', // zero means: skip this pool
    amount_pool_it: '500',
  });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\/portal$/);

  const api = await get('/api/portfolio');
  assert.equal(api.status, 200);
  const snap = await api.json();
  assert.equal(snap.totalPrincipalCents, 120000);
  assert.equal(snap.allocation.length, 3); // real-estate skipped
  assert.ok(snap.combined.length > 100, 'expected backfilled daily series');
  assert.ok(snap.positions.every((p) => p.valueCents > 0));
});

test('early withdrawal requires confirmation, then credits virtual cash', async () => {
  const page = await get('/portal/withdraw');
  const html = await page.text();
  const posId = (html.match(/withdraw\/(pos_[a-f0-9]+)/) || [])[1];
  assert.ok(posId, 'no position id on the withdraw page');

  const unconfirmed = await postForm(`/portal/withdraw/${posId}`, {});
  assert.equal(unconfirmed.status, 302);
  assert.match(unconfirmed.headers.get('location'), /\/portal\/withdraw$/);

  const confirmed = await postForm(`/portal/withdraw/${posId}`, { confirm_penalty: 'yes' });
  assert.equal(confirmed.status, 302);
  assert.match(confirmed.headers.get('location'), /\/portal$/);

  const snap = await (await get('/api/portfolio')).json();
  assert.equal(snap.allocation.length, 2);
  assert.ok(snap.cashBalanceCents > 0, 'net proceeds should land in virtual cash');
});

test('password change verifies the current password', async () => {
  await get('/portal/settings');
  const bad = await postForm('/portal/settings/password', {
    current: 'wrong-password',
    new: 'An0ther-Passw0rd!',
    confirm: 'An0ther-Passw0rd!',
  });
  assert.equal(bad.status, 422);

  const ok = await postForm('/portal/settings/password', {
    current: 'Str0ng-Passw0rd!',
    new: 'An0ther-Passw0rd!',
    confirm: 'An0ther-Passw0rd!',
  });
  assert.equal(ok.status, 302);
});

let totpSecret;

test('2FA enrolment: QR + manual key, wrong code rejected, right code enables', async () => {
  await get('/portal/settings');
  const setup = await postForm('/portal/settings/2fa/setup', {});
  assert.equal(setup.status, 200);
  const html = await setup.text();
  assert.match(html, /data:image\/png;base64/, 'expected a QR data URL');
  totpSecret = (html.match(/>([A-Z2-7]{16,})</) || [])[1];
  assert.ok(totpSecret, 'no base32 secret rendered');

  const wrong = await postForm('/portal/settings/2fa/enable', { token: '000000' });
  assert.equal(wrong.status, 422);

  const token = speakeasy.totp({ secret: totpSecret, encoding: 'base32' });
  const ok = await postForm('/portal/settings/2fa/enable', { token });
  assert.equal(ok.status, 302);
});

test('login with 2FA challenges for a code before granting a session', async () => {
  await postForm('/logout', {});
  await get('/login');
  const login = await postForm('/login', {
    email: 'journey@example.com',
    password: 'An0ther-Passw0rd!',
  });
  assert.equal(login.status, 302);
  assert.match(login.headers.get('location'), /\/login\/2fa$/);

  // Not authenticated yet: the portal must still redirect.
  const portal = await get('/portal');
  assert.equal(portal.status, 302);

  await get('/login/2fa');
  const token = speakeasy.totp({ secret: totpSecret, encoding: 'base32' });
  const verify = await postForm('/login/2fa', { token });
  assert.equal(verify.status, 302);
  assert.match(verify.headers.get('location'), /\/portal$/);

  const dash = await get('/portal');
  assert.equal(dash.status, 200);
  const html = await dash.text();
  assert.match(html, /Available cash/);
});

test('active sessions are listed and the audit log records events', async () => {
  const res = await get('/portal/settings');
  const html = await res.text();
  assert.match(html, /this session/);
  assert.match(html, /2fa\.enabled/);
  assert.match(html, /login\.success/);
});

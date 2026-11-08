import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const text = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const [schema, statusSql] = await Promise.all([text('../schema.sql'), text('../status.sql')]);
// Explicit, strictly increasing request times (all within subscribe's 5 minute future allowance) avoid 409 ordering flakes.
let seq = 0;
const stamp = () => new Date(Date.now() + 60_000 + 1000 * seq++).toISOString();
const wf = JSON.parse(await text('../status.json'));

test('status.json: one header-auth webhook, no email nodes, only the status function', () => {
  const hooks = wf.nodes.filter((n) => n.type.endsWith('.webhook'));
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].parameters.authentication, 'headerAuth');
  assert.equal(hooks[0].parameters.responseMode, 'responseNode');
  assert.equal(wf.active, false);
  assert.ok(!wf.nodes.some((n) => /emailSend|smtp/i.test(n.type)));
  for (const n of wf.nodes) assert.equal(n.credentials, undefined);
  const queries = wf.nodes.filter((n) => n.type.endsWith('.postgres')).map((n) => n.parameters.query);
  assert.deepEqual(queries, ['SELECT handshake.notification_status($1::text) AS result']);
  const names = new Set(wf.nodes.map((n) => n.name));
  for (const o of Object.values(wf.connections)) for (const b of o.main) for (const e of b) assert.ok(names.has(e.node));
});

test('status.sql is read-only and exposes no email or token keys', () => {
  assert.match(statusSql, /CREATE OR REPLACE FUNCTION handshake\.notification_status/);
  assert.match(statusSql, /STABLE/);
  assert.doesNotMatch(statusSql.replace(/--.*$/gm, ''), /\b(INSERT|UPDATE|DELETE)\b/i);
  const keys = [...statusSql.matchAll(/jsonb_build_object\(([\s\S]*?)\)\s*;/g)].flatMap((m) => [...m[1].matchAll(/'(\w+)'/g)].map((k) => k[1]));
  assert.ok(keys.length > 0);
  const allowed = /^(contact|recap|expired|delivery|none|stopped|ok|pending|confirmed|requested|awaiting_confirmation)$/;
  for (const k of keys) assert.match(k, allowed);
});

test('notification_status reports each state without leaking data', async () => {
  const db = new PGlite();
  try {
    await db.exec(schema);
    await db.exec(statusSql);
    await db.exec(statusSql); // idempotent
    const st = async (id) => (await db.query('select handshake.notification_status($1) as r', [id])).rows[0].r;
    const none = { contact: 'none', recap: 'none', expired: false, delivery: 'ok' };
    assert.deepEqual(await st('x'), none);
    assert.deepEqual(await st(''), none);
    assert.deepEqual(await st('a'.repeat(101)), none);
    assert.deepEqual(await st(null), none);
    const sub = (p) => db.query('select handshake.subscribe($1::jsonb)', [JSON.stringify({ requestedAt: stamp(), ...p })]);
    await sub({ action: 'subscribe', learnerId: 'l1', contactEmail: 'c@example.test', learnerEmail: 'l@example.test' });
    const r = await st('l1');
    assert.deepEqual(r, { contact: 'awaiting_confirmation', recap: 'requested', expired: false, delivery: 'pending' });
    assert.ok(!JSON.stringify(r).includes('example.test'));
    await db.exec("update handshake.learners set contact_token_created_at = now() - interval '8 days'");
    assert.equal((await st('l1')).expired, true);
    await db.exec("update handshake.learners set contact_confirmed_at = now(), confirmation_delivery_pending = false");
    assert.deepEqual(await st('l1'), { contact: 'confirmed', recap: 'requested', expired: false, delivery: 'ok' });
    await sub({ action: 'unsubscribe', learnerId: 'l1' });
    assert.deepEqual(await st('l1'), { contact: 'stopped', recap: 'stopped', expired: false, delivery: 'ok' });
  } finally { await db.close(); }
});

// Not covered: EXECUTE rights for a non-owner n8n role (PGlite has no role separation); check on the real database.
async function withDb(fn) {
  const db = new PGlite();
  try {
    await db.exec(schema);
    await db.exec(statusSql);
    const st = async (id) => (await db.query('select handshake.notification_status($1) as r', [id])).rows[0].r;
    const sub = async (p) => (await db.query('select handshake.subscribe($1::jsonb) as r', [JSON.stringify({ requestedAt: stamp(), ...p })])).rows[0].r;
    const link = async (action, token) => (await db.query('select handshake.contact_action($1,$2) as r', [action, token])).rows[0].r;
    const row = async (id) => (await db.query('select * from handshake.learners where learner_id=$1', [id])).rows[0];
    await fn({ db, st, sub, link, row });
  } finally { await db.close(); }
}
const withContact = { action: 'subscribe', contactEmail: 'c@example.test' };

test('recap-only subscribe is none/requested', () => withDb(async ({ st, sub }) => {
  await sub({ action: 'subscribe', learnerId: 'r1', learnerEmail: 'l@example.test' });
  assert.deepEqual(await st('r1'), { contact: 'none', recap: 'requested', expired: false, delivery: 'ok' });
}));

test('contact-only unsubscribe on a confirmed row is none/requested', () => withDb(async ({ st, sub, link, row }) => {
  await sub({ ...withContact, learnerId: 'c1', learnerEmail: 'l@example.test' });
  await link('confirm', (await row('c1')).contact_token);
  const r = await row('c1');
  assert.equal(r.contact_token, null);
  assert.equal(r.contact_token_created_at, null);
  assert.deepEqual(await st('c1'), { contact: 'confirmed', recap: 'requested', expired: false, delivery: 'ok' });
  assert.equal((await link('unsubscribe', r.unsubscribe_token)).changed, true);
  assert.deepEqual(await st('c1'), { contact: 'none', recap: 'requested', expired: false, delivery: 'ok' });
}));

test('learner-unsubscribe link is stopped/stopped; re-subscribe after a full Stop starts over', () => withDb(async ({ st, sub, link, row }) => {
  await sub({ ...withContact, learnerId: 's1', learnerEmail: 'l@example.test' });
  assert.equal((await link('learner-unsubscribe', (await row('s1')).learner_unsubscribe_token)).changed, true);
  assert.deepEqual(await st('s1'), { contact: 'stopped', recap: 'stopped', expired: false, delivery: 'ok' });
  assert.equal((await sub({ ...withContact, learnerId: 's1', contactEmail: 'new@example.test' })).status, 200);
  assert.equal((await st('s1')).contact, 'awaiting_confirmation');
}));

test('expiry boundary is 7 days', () => withDb(async ({ db, st, sub }) => {
  await sub({ ...withContact, learnerId: 'e1' });
  await db.exec("update handshake.learners set contact_token_created_at = now() - interval '6 days 23 hours'");
  assert.equal((await st('e1')).expired, false);
  await db.exec("update handshake.learners set contact_token_created_at = now() - interval '7 days 1 hour'");
  assert.equal((await st('e1')).expired, true);
}));

test('delivery is cleared when the contact unsubscribes before the send was acknowledged', () => withDb(async ({ st, sub, link, row }) => {
  await sub({ ...withContact, learnerId: 'd1', learnerEmail: 'l@example.test' });
  assert.equal((await st('d1')).delivery, 'pending');
  await link('unsubscribe', (await row('d1')).unsubscribe_token);
  assert.deepEqual(await st('d1'), { contact: 'none', recap: 'requested', expired: false, delivery: 'ok' });
}));

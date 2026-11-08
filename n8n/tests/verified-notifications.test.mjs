import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { lessonWorkflow } from '../build-delivery.mjs';

test('eligible lesson follows the connected graph to SMTP, success and failure responses', () => {
  const w = lessonWorkflow();
  const next = (name, output = 0) => w.connections[name]?.main[output]?.map(e => e.node) ?? [];
  assert.deepEqual(next('Contact still subscribed'), ['Send lesson']);
  assert.deepEqual(next('Send lesson'), ['Lesson sent']);
  assert.deepEqual(next('Send lesson', 1), ['Lesson failed']);
  assert.deepEqual(next('Lesson failed'), ['SMTP failure']);
});

async function fixture() {
  const db = new PGlite();
  for (const file of ['schema.sql', 'lesson.sql', 'recap.sql', 'migrations/002-learner-confirmation.sql']) {
    await db.exec(await readFile(new URL('../' + file, import.meta.url), 'utf8'));
  }
  return db;
}
let sequence = 0;
const subscribe = async (db, email = 'learner@example.test', extra = {}) => (await db.query(
  'select handshake.subscribe_verified($1::jsonb) as result',
  [JSON.stringify({ action: 'subscribe', requestedAt: new Date(Date.now() + sequence++).toISOString(), learnerId: 'a', learnerEmail: email, ...extra })],
)).rows[0].result;
const learner = async db => (await db.query("select * from handshake.learners where learner_id='a'")).rows[0];
const confirm = async (db, token) => (await db.query('select handshake.learner_confirm($1) as result', [token])).rows[0].result;
const claims = async db => (await db.query('select handshake.confirmed_recap_claim() as result')).rows.map(r => r.result);

test('learner must explicitly confirm before a general recap can be claimed; token is single use', async () => {
  const db = await fixture();
  try {
    const s = await subscribe(db);
    assert.equal(s.learnerSend, true);
    assert.equal(s.learnerEmail, 'learner@example.test');
    assert.equal((await claims(db)).length, 0);
    assert.equal((await confirm(db, s.learnerToken)).changed, true);
    assert.equal((await confirm(db, s.learnerToken)).changed, false);
    const [c] = await claims(db);
    assert.equal(c.learnerId, 'a');
    const r = (await db.query('select handshake.confirmed_recap_recheck($1,$2::uuid) as result', ['a', c.lease])).rows[0].result;
    assert.equal(r.email, 'learner@example.test');
    assert.equal((await claims(db)).length, 0);
  } finally { await db.close(); }
});

test('pending learner SMTP cannot report save success; acknowledgement and confirmed unchanged save are safe', async () => {
  const db = await fixture();
  try {
    const first = await subscribe(db);
    assert.equal((await subscribe(db)).status, 503);
    await db.query('select handshake.learner_confirmation_sent($1)', [first.learnerToken]);
    assert.equal((await subscribe(db)).learnerSend, false);
    await confirm(db, first.learnerToken);
    assert.equal((await subscribe(db)).status, 200);
    assert.ok((await learner(db)).learner_confirmed_at);
  } finally { await db.close(); }
});

test('address change invalidates learner consent, queued recap and old token; expiry and Stop suppress delivery', async () => {
  const db = await fixture();
  try {
    const first = await subscribe(db);
    await confirm(db, first.learnerToken);
    const [c] = await claims(db);
    const second = await subscribe(db, 'new@example.test');
    assert.equal((await confirm(db, first.learnerToken)).changed, false);
    const r = (await db.query('select handshake.confirmed_recap_recheck($1,$2::uuid) as result', ['a', c.lease])).rows[0].result;
    assert.equal(r.send, false);
    assert.equal((await learner(db)).learner_confirmed_at, null);
    await db.exec("update handshake.learners set learner_token_created_at=now()-interval '8 days'");
    assert.equal((await confirm(db, second.learnerToken)).changed, false);
    assert.equal((await subscribe(db, 'new@example.test', { action: 'unsubscribe' })).status, 200);
    assert.equal(await learner(db), undefined);
    assert.equal((await confirm(db, second.learnerToken)).changed, false);
    assert.equal((await claims(db)).length, 0);
  } finally { await db.close(); }
});

test('learner and contact confirmations share budgets and a rejected save leaves no partial subscription', async () => {
  const db = await fixture();
  try {
    await subscribe(db);
    const r = await subscribe(db, 'learner@example.test', { learnerId: 'b', contactEmail: 'new-contact@example.test' });
    assert.equal(r.status, 429);
    assert.equal((await db.query("select * from handshake.learners where learner_id='b'")).rows.length, 0);
    assert.equal((await db.query("select * from handshake.confirmation_reservations where address='new-contact@example.test'")).rows.length, 0);
  } finally { await db.close(); }
});

test('migration can be reapplied without losing existing subscriptions or granting old addresses consent', async () => {
  const db = new PGlite();
  try {
    for (const file of ['schema.sql', 'recap.sql']) await db.exec(await readFile(new URL('../' + file, import.meta.url), 'utf8'));
    await db.query('select handshake.subscribe($1::jsonb)', [JSON.stringify({ action: 'subscribe', requestedAt: new Date().toISOString(), learnerId: 'a', learnerEmail: 'existing@example.test' })]);
    const migration = await readFile(new URL('../migrations/002-learner-confirmation.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    assert.equal((await learner(db)).learner_email, 'existing@example.test');
    assert.equal((await claims(db)).length, 0);
    assert.equal((await subscribe(db, 'existing@example.test')).learnerSend, true);
  } finally { await db.close(); }
});

test('same inbox receives one confirmation email with separate learner and contact consent links', async () => {
  const db = await fixture();
  try {
    const s = await subscribe(db, 'same@example.test', { contactEmail: 'same@example.test' });
    assert.equal(s.status, 200);
    assert.equal(s.send, true);
    assert.equal(s.learnerSend, false);
    assert.equal(s.learnerIncluded, true);
    assert.notEqual(s.token, s.learnerToken);
    assert.equal((await db.query('select * from handshake.confirmation_reservations')).rows.length, 1);
    await db.query('select handshake.contact_action($1,$2)', ['confirm', s.token]);
    assert.equal((await claims(db)).length, 0);
    assert.equal((await confirm(db, s.learnerToken)).changed, true);
    assert.equal((await claims(db)).length, 1);
  } finally { await db.close(); }
});

const evaluate = (value, json, history, vars) => typeof value === 'string' && value.startsWith('={{')
  ? Function('$json', '$', '$vars', `return (${value.slice(3, -2).trim()});`)(json,
    name => ({ first: () => ({ json: history[name] }), item: { json: history[name] } }), vars)
  : value;

test('exported subscription executes both SMTP paths and acknowledges only accepted sends', async () => {
  const workflow = JSON.parse(await readFile(new URL('../subscribe.json', import.meta.url), 'utf8'));
  const vars = { HANDSHAKE_FROM_EMAIL: 'sender@example.test', HANDSHAKE_LINK_ORIGIN: 'https://notify.example.test' };
  for (const sameInbox of [false, true]) {
    const db = await fixture();
    try {
      const history = {}, emails = [];
      let responses = 0;
      let name = 'Subscribe', json = { body: { action: 'subscribe', learnerId: 'a', requestedAt: new Date(Date.now() + sequence++).toISOString(), learnerEmail: 'learner@example.test', contactEmail: sameInbox ? 'learner@example.test' : 'contact@example.test' } };
      for (let steps = 0; name && steps < 20; steps++) {
        const node = workflow.nodes.find(n => n.name === name);
        let branch = 0;
        if (node.type.endsWith('.postgres')) {
          json = (await db.query(node.parameters.query, evaluate(node.parameters.options.queryReplacement, json, history, vars))).rows[0];
        } else if (node.type.endsWith('.if')) {
          branch = evaluate(node.parameters.conditions.conditions[0].leftValue, json, history, vars) === true ? 0 : 1;
        } else if (node.type.endsWith('.emailSend')) {
          emails.push(Object.fromEntries(['toEmail', 'text', 'html'].map(k => [k, evaluate(node.parameters[k], json, history, vars)])));
          json = { accepted: true };
        } else if (node.type.endsWith('.respondToWebhook')) {
          responses++;
          assert.equal(evaluate(node.parameters.options.responseCode, json, history, vars), 200);
          assert.deepEqual(evaluate(node.parameters.responseBody, json, history, vars), { ok: true });
          break;
        }
        history[name] = json;
        name = workflow.connections[name]?.main[branch]?.[0]?.node;
      }
      assert.equal(responses, 1, 'subscription must reach one successful HTTP response');
      assert.equal(emails.length, sameInbox ? 1 : 2);
      const r = await learner(db);
      assert.equal(r.confirmation_delivery_pending, false);
      assert.equal(r.learner_confirmation_pending, false);
      assert.equal(r.learner_confirmed_at, null);
      const contactMail = emails[0], learnerMail = sameInbox ? emails[0] : emails[1];
      assert.ok(contactMail.html.includes('/webhook/handshake-confirm?token=' + r.contact_token));
      assert.ok(learnerMail.html.includes('/webhook/handshake-learner-confirm?token=' + r.learner_token));
      assert.ok(learnerMail.text.includes('/webhook/handshake-learner-confirm?token=' + r.learner_token));
      assert.ok(!learnerMail.html.includes('placeholder'));
    } finally { await db.close(); }
  }
});

test('learner confirmation landing uses explicit POST and only the POST consumes consent', async () => {
  const w = JSON.parse(await readFile(new URL('../contact-links.json', import.meta.url), 'utf8'));
  const db = await fixture();
  try {
    const s = await subscribe(db);
    const code = w.nodes.find(n => n.name === 'Build learner landing').parameters.jsCode;
    const html = Function('$json', '$vars', code)({ query: { token: s.learnerToken } }, { HANDSHAKE_LINK_ORIGIN: 'https://notify.example.test' })[0].json.html;
    assert.match(html, /method="post"/);
    assert.match(html, /action="https:\/\/notify.example.test\/webhook\/handshake-learner-confirm"/);
    assert.equal((await learner(db)).learner_confirmed_at, null);
    const n = w.nodes.find(n => n.name === 'Consume learner confirmation');
    const r = (await db.query(n.parameters.query, evaluate(n.parameters.options.queryReplacement, { body: { token: s.learnerToken } }, {}, {}))).rows[0];
    assert.equal(r.result.changed, true);
    assert.ok((await learner(db)).learner_confirmed_at);
    assert.equal(w.connections['Learner confirm action'].main[0][0].node, 'Consume learner confirmation');
  } finally { await db.close(); }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {isolatedCandidateBackend} from './helpers/isolated-candidate-backend.mjs';

const readActions = ['resolve_miniapp_entry', 'client_portal_bootstrap', 'bootstrap',
  'client', 'health', 'preview_calendar_onboarding'];
const mutationActions = ['client_portal_enroll', 'create_client_portal_invite',
  'revoke_client_portal_invite', 'create_client_measurement', 'correct_client_measurement',
  'resolve_calendar_onboarding', 'set_queue_decision', 'confirm_day'];
const request = (f, action, payload = {}) => ({dmsMiniApp: 'dms-fitness-miniapp',
  version: 1, initData: f.signedInitData(), action,
  ...(['resolve_miniapp_entry', 'client_portal_bootstrap'].includes(action) ? {} : {payload})});
// Call the actual ingress, deliberately avoiding fixture.post's read-only allowlist.
const post = (f, body, parameter = {}) => f.context.doPost({parameter,
  postData: {contents: JSON.stringify(body), type: 'application/json'}}).text;
function telegramBoundary(f) {
  const calls = [];
  f.context.UrlFetchApp.fetch = (url, options) => {
    calls.push({url, options});
    return {getResponseCode: () => 200, getContentText: () => JSON.stringify({ok: true,
      result: {message_id: 7, username: 'fixture_bot', has_main_web_app: true}})};
  };
  return calls;
}

for (const version of ['v56', 'v57']) {
  test(`${version} ingress maintenance blocks signed reads as well as mutations`, () => {
    const fixture = isolatedCandidateBackend(version);
    assert.equal(fixture.get().release, version === 'v56'
      ? 'emergency-semantic-recovery' : 'post-burn-in-audit', 'test must load the named bundle');
    const request = {dmsMiniApp: 'dms-fitness-miniapp', version: 1,
      initData: fixture.signedInitData(), action: 'bootstrap'};
    assert.equal(fixture.post(request).ok, true, 'signed read works before maintenance');
    fixture.context.PropertiesService.getScriptProperties().deleteProperty('DMS_P1_RELEASE_READY');
    const response = fixture.context.doPost({postData: {
      contents: JSON.stringify(request), type: 'application/json',
    }});
    assert.equal(response.text, 'ok');
    assert.throws(() => JSON.parse(response.text), SyntaxError,
      'Web cannot perform a signed smoke through the closed ingress');
    assert.equal(fixture.book.writes.length, 0);
  });

  for (const open of [false, true]) {
    test(`${version} ${open ? 'open' : 'closed'} GET is liveness/identity only, never action dispatch`, () => {
      const f = isolatedCandidateBackend(version);
      if (!open) f.context.PropertiesService.getScriptProperties().deleteProperty('DMS_P1_RELEASE_READY');
      assert.match(f.context.doGet({parameter: {}}).text, /integration is running/);
      assert.equal(f.get().service, 'dms-fitness-apps-script');
      for (const action of [...readActions, ...mutationActions]) {
        assert.match(f.context.doGet({parameter: {action, clientId: 'CL-SINGLE'}}).text, /integration is running/);
      }
      assert.equal(f.book.writes.length, 0);
      assert.equal(f.book.reads.length, 0);
    });
  }

  test(`${version} closed ingress blocks every current signed read/mutation route before service access`, () => {
    const f = isolatedCandidateBackend(version), calls = telegramBoundary(f);
    f.context.PropertiesService.getScriptProperties().deleteProperty('DMS_P1_RELEASE_READY');
    for (const action of [...readActions, ...mutationActions]) {
      assert.equal(post(f, request(f, action, {clientId: 'CL-SINGLE'})), 'ok', action);
    }
    const update = {update_id: 1, message: {from: {id: 1001}, chat: {id: 2002}, text: '/start'}};
    assert.equal(post(f, update, {key: 'fixture-webhook'}), 'ok');
    assert.equal(post(f, {update_id: 2, callback_query: {id: 'fixture', data: 'qd:Q-TODAY:free',
      from: {id: 1001}, message: {message_id: 7, chat: {id: 2002}}}}, {key: 'fixture-webhook'}), 'ok');
    assert.equal(f.book.reads.length, 0);
    assert.equal(f.book.writes.length, 0);
    assert.equal(calls.length, 0);
  });

  test(`${version} open signed reads reach real handlers and auth still fails closed`, () => {
    const f = isolatedCandidateBackend(version);
    for (const [action, payload] of [['bootstrap', {}], ['client', {clientId: 'CL-SINGLE'}],
      ['health', {}], ['preview_calendar_onboarding', {queueId: 'Q-UNKNOWN', mode: 'ignore'}],
      ['resolve_miniapp_entry', {}]]) {
      const result = JSON.parse(post(f, request(f, action, payload)));
      assert.equal(result.ok, true, JSON.stringify(result));
    }
    const expired = {...request(f, 'bootstrap'), initData: f.signedInitData(21601)};
    assert.equal(JSON.parse(post(f, expired)).error, 'expired_init_data');
    assert.equal(JSON.parse(post(f, {...request(f, 'bootstrap'), initData: 'invalid'})).ok, false);
    assert.equal(f.book.writes.length, 0);
  });

  test(`${version} open Telegram read authenticates webhook/admin and closed never sends`, () => {
    const f = isolatedCandidateBackend(version), calls = telegramBoundary(f);
    const update = {update_id: 11, message: {from: {id: 1001}, chat: {id: 2002}, text: '/start'}};
    assert.equal(post(f, update, {key: 'wrong'}), 'forbidden');
    assert.equal(calls.length, 0);
    assert.equal(post(f, {...update, message: {...update.message, from: {id: 999}}}, {key: 'fixture-webhook'}), 'ok');
    assert.equal(calls.length, 0);
    assert.equal(post(f, {...update, update_id: 12}, {key: 'fixture-webhook'}), 'ok');
    assert.ok(calls.some(c => c.url.endsWith('/sendMessage')));
    assert.equal(f.book.writes.length, 0);
  });

  test(`${version} reopening restores actual mutation routing only in isolated fixture`, () => {
    const f = isolatedCandidateBackend(version), calls = telegramBoundary(f);
    const props = f.context.PropertiesService.getScriptProperties();
    const marker = props.getProperty('DMS_P1_RELEASE_READY');
    const body = request(f, 'create_client_portal_invite', {clientId: 'CL-SINGLE'});
    props.deleteProperty('DMS_P1_RELEASE_READY');
    assert.equal(post(f, body), 'ok');
    assert.equal(calls.length, 0);
    assert.equal(f.book.writes.length, 0);
    props.setProperty('DMS_P1_RELEASE_READY', marker);
    const result = JSON.parse(post(f, body));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(f.book.writes.length > 0, 'real domain mutation executes in fixture after reopening');
    const writes = f.book.writes.length;
    props.deleteProperty('DMS_P1_RELEASE_READY');
    assert.equal(post(f, body), 'ok');
    assert.equal(f.book.writes.length, writes);
  });

  test(`${version} closure blocks new mutation leases but does not revoke an acquired lease`, () => {
    const f = isolatedCandidateBackend(version);
    const lease = f.context.getDmsMutationLock_();
    assert.equal(lease.tryLock(1), true);
    f.context.PropertiesService.getScriptProperties().deleteProperty('DMS_P1_RELEASE_READY');
    assert.equal(lease.hasLock(), true);
    assert.equal(lease.tryLock(1), true, 'in-flight ownership is why execution drain is required');
    assert.throws(() => f.context.getDmsMutationLock_().tryLock(1), /release|maintenance/i);
    lease.releaseLock();
    assert.equal(lease.hasLock(), false);
    assert.throws(() => f.context.getDmsMutationLock_().tryLock(1), /release|maintenance/i);
  });
}

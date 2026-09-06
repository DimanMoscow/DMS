import assert from 'node:assert/strict';
import test from 'node:test';
import {loadBundle} from './helpers/apps-script-bundle.mjs';

function request(body, key) {return {postData: {contents: body}, parameter: {key}};}

test('P1.1 reproduction: v50 malformed unauthenticated JSON appends audit', () => {
  const fixture = loadBundle('v50');
  fixture.context.doPost(request('{"private-fixture":', undefined));
  assert.equal(fixture.writes.filter(write => write.method === 'appendRow').length, 1);
});

const cases = [
  ['malformed JSON', '{"private-fixture":', undefined],
  ['empty body', '', undefined],
  ['missing secret', '{"update_id":1}', undefined],
  ['wrong secret', '{"update_id":1}', 'wrong'],
  ['oversized', JSON.stringify({text: 'x'.repeat(65537)}), undefined],
  ['invalid null', 'null', undefined],
  ['invalid array', '[]', undefined],
  ['invalid scalar', 'true', undefined],
  ['malformed despite correct webhook', '{"private-fixture":', 'fixture-webhook'],
  ['MiniApp invalid auth', '{"dmsMiniApp":"dms-fitness-miniapp","version":1,"initData":"private-fixture"}', undefined],
];
for (const [name, body, key] of cases) {
  test(`P1.1 full bundle: ${name} has zero Sheet writes and redacted logs`, () => {
    const fixture = loadBundle();
    assert.equal(fixture.fileCount, 19);
    for (let attempt = 0; attempt < 20; attempt++) fixture.context.doPost(request(body, key));
    assert.deepEqual(fixture.writes, []);
    assert.ok(fixture.logs.every(log => log === 'DMS ingress request failed'));
  });
}

test('P1.1 valid webhook delivery still dispatches and deduplicates', () => {
  const fixture = loadBundle();
  let calls = 0;
  fixture.context.handleTelegramMessage_ = () => calls++;
  const input = request(JSON.stringify({update_id: 42, message: {text: '/menu'}}), 'fixture-webhook');
  assert.equal(fixture.context.doPost(input).text, 'ok');
  fixture.context.doPost(input);
  assert.equal(calls, 1);
});

test('P1.1 unexpected authentication exception cannot reach audit', () => {
  const fixture = loadBundle();
  fixture.context.isValidTelegramWebhook_ = () => {throw new Error('private-fixture');};
  fixture.context.doPost(request('{}', 'fixture-webhook'));
  assert.deepEqual(fixture.writes, []);
  assert.deepEqual(fixture.logs, ['DMS ingress request failed']);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {isolatedCandidateBackend} from './helpers/isolated-candidate-backend.mjs';

for (const version of ['v56', 'v57']) {
  test(`${version} ingress maintenance blocks signed reads as well as mutations`, () => {
    const fixture = isolatedCandidateBackend(version);
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
}

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {fingerprint, createAcceptancePackage, openActivation, evaluateActivation} from './release-reconciliation.mjs';
import {compileCalendarAcceptance} from './calendar-acceptance-evidence.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export function readActivationJournal(file) {
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(raw.endsWith('\n'), 'incomplete activation journal; stop, do not reset');
  const records = raw.trim().split('\n').map(line => JSON.parse(line));
  let previous = null;
  for (const record of records) {
    const {hash, ...body} = record;
    assert.equal(body.previous, previous, 'journal chain differs');
    assert.equal(hash, fingerprint(body), 'journal hash differs');
    previous = hash;
  }
  assert.ok(records.length > 0);
  return records.at(-1);
}
export function appendActivation(file, result, {initial = false} = {}) {
  const previous = initial ? null : readActivationJournal(file).hash;
  const body = {previous, ...result};
  const record = {...body, hash: fingerprint(body)};
  const fd = fs.openSync(file, initial ? 'wx' : 'a', 0o600);
  try { fs.writeSync(fd, JSON.stringify(record) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  return record;
}
export function runAcceptanceCli(args) {
  const [command, ...rest] = args;
  assert.ok(['prepare', 'admit', 'check'].includes(command), 'expected prepare/admit/check');
  const flags = {};
  for (let i = 0; i < rest.length; i += 2) {
    assert.ok(['--evidence', '--capture-envelope', '--package', '--approved-fingerprint', '--journal', '--observation'].includes(rest[i]));
    assert.ok(rest[i + 1] && !flags[rest[i]], 'missing or duplicate argument');
    flags[rest[i]] = rest[i + 1];
  }
  assert.ok(flags['--package'], '--package required (private path)');
  if (command === 'prepare') {
    assert.ok(Boolean(flags['--evidence']) !== Boolean(flags['--capture-envelope']), 'supply one evidence source');
    const approved = flags['--capture-envelope'] ? compileCalendarAcceptance(read(flags['--capture-envelope'])).package :
      createAcceptancePackage(read(flags['--evidence']));
    fs.writeFileSync(flags['--package'], JSON.stringify(approved, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    return {status: 'AWAITING_SEPARATE_APPROVAL', fingerprint: approved.fingerprint,
      issues: approved.issues.length, expiresAt: approved.expiresAt};
  }
  const approved = read(flags['--package']);
  assert.ok(flags['--journal'] && flags['--approved-fingerprint'], 'journal and separately pinned approval required');
  const lock = flags['--journal'] + '.lock';
  const fd = fs.openSync(lock, 'wx', 0o600);
  try {
    if (command === 'admit') {
      const state = openActivation(approved, flags['--approved-fingerprint'], new Date().toISOString());
      appendActivation(flags['--journal'], {state, verdict: 'ADMITTED'}, {initial: true});
      return {status: 'ADMITTED', productionWrites: 0};
    }
    const prior = readActivationJournal(flags['--journal']);
    const result = evaluateActivation(approved, flags['--approved-fingerprint'], prior.state, read(flags['--observation']));
    appendActivation(flags['--journal'], result); // Includes consumed exceptions on failure.
    return {status: result.verdict, reason: result.reason, productionWrites: 0};
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = runAcceptanceCli(process.argv.slice(2)); console.log(JSON.stringify(result));
    if (result.status === 'NO_GO') process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

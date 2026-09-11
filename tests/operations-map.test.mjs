import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const map = fs.readFileSync(path.join(root, 'docs', 'OPERATIONS_MAP.md'), 'utf8');
const route = fs.readFileSync(path.join(root, 'app', 'api', 'dms', 'route.ts'), 'utf8');
const scheduled = fs.readFileSync(path.join(
  root,
  'apps-script',
  'versions',
  'v56',
  'ZZZZZZZZZZZZZZZZReleaseSafety.gs',
), 'utf8');
const snapshotRoot = path.join(root, 'apps-script', 'versions', 'v56');

function quotedValues(block) {
  return [...block.matchAll(/["']([a-z][a-z0-9_]*)["']/g)].map(match => match[1]);
}

test('operations map has the required auditable columns', () => {
  assert.match(map, /\| Operation \| Entry points \| Canonical domain function \| Reads \| Writes \| Lock \| Side effects \| Audit \|/);
  assert.match(map, /## Independently implemented business paths/);
  assert.match(map, /## Performance baseline before optimization/);
});

test('operations map covers every MiniApp production action', () => {
  const allowList = route.match(/const actions = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(allowList, 'MiniApp action allow-list was not found');
  const actions = quotedValues(allowList[1]);
  assert.ok(actions.length >= 10, 'MiniApp action inventory unexpectedly shrank');
  for (const action of actions) {
    assert.ok(map.includes('`' + action + '`'), `missing MiniApp action: ${action}`);
  }
});

test('operations map covers every managed scheduled handler', () => {
  const specs = scheduled.match(/SPECS:\s*\[([\s\S]*?)\]\s*\n};/);
  assert.ok(specs, 'scheduled automation specs were not found');
  const handlers = [...specs[1].matchAll(/handler:\s*'([^']+)'/g)].map(match => match[1]);
  assert.equal(handlers.length, 5, 'managed scheduled handler inventory changed');
  for (const handler of handlers) {
    assert.ok(map.includes('`' + handler + '`'), `missing scheduled handler: ${handler}`);
  }
});

test('operations map names every v56 global Apps Script entry point', () => {
  const globals = fs.readdirSync(snapshotRoot)
    .filter(name => name.endsWith('.gs'))
    .flatMap(name => {
      const source = fs.readFileSync(path.join(snapshotRoot, name), 'utf8');
      return [...source.matchAll(/^function ([A-Za-z0-9]+)\(/gm)]
        .map(match => match[1])
        .filter(name => !name.endsWith('_'));
    });
  assert.ok(globals.length >= 40, 'v56 global entry inventory unexpectedly shrank');
  for (const name of globals) {
    assert.ok(map.includes('`' + name + '`'), `missing Apps Script global entry: ${name}`);
  }
});

test('operations map anchors the audited v54 baseline', () => {
  for (const evidence of [
    '4a1d9568ae30f3cf54e0a6858456bbf656b699ff',
    '12.854 s',
    '22.109 s',
    '7.852 s',
    '2.0–3.1 s',
  ]) {
    assert.ok(map.includes(evidence), `missing baseline evidence: ${evidence}`);
  }
});

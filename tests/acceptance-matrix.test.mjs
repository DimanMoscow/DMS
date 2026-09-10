import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const matrixPath = 'docs/ACCEPTANCE_MATRIX.md';
const matrix = fs.readFileSync(matrixPath, 'utf8');

test('stabilization acceptance matrix covers every required scenario with existing evidence', () => {
  const required = Array.from({length: 16}, (_, index) => `A${String(index + 1).padStart(2, '0')}`);
  for (const id of required) {
    const rows = matrix.split('\n').filter(line => line.startsWith(`| ${id} |`));
    assert.equal(rows.length, 1, `${id} must have exactly one acceptance row`);
    assert.match(rows[0], /\| covered: (fixture|fixture \+ isolated copy) \|$/);
  }

  const references = [...matrix.matchAll(/`(tests\/[^`]+\.test\.mjs)`/g)].map(match => match[1]);
  assert.ok(references.length >= required.length);
  for (const reference of references) assert.equal(fs.existsSync(reference), true, reference);
});

test('acceptance policy forbids production mutation smoke', () => {
  assert.match(matrix, /Production acceptance is limited to read-only/i);
  assert.match(matrix, /business mutations are forbidden as release smoke/i);
});

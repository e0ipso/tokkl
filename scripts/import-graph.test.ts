import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCycles, layerViolations, relativeSpecifiers, type ImportGraph } from './import-graph.ts';

test('relative specifiers come from every import form, type-only ones included', () => {
  const text = [
    "import type { A } from './a.ts';",
    "import { B } from '../b.ts';",
    "export { C } from './c.ts';",
    "import './side.ts';",
    "const d = await import('./d.ts');",
    "import express from 'express';",
    "import {\n  E,\n} from './e.ts';",
  ].join('\n');
  assert.deepEqual(relativeSpecifiers(text), ['./a.ts', '../b.ts', './c.ts', './side.ts', './d.ts', './e.ts']);
});

test('a cycle is reported once with its files in import order, and a diamond is not a cycle', () => {
  const graph: ImportGraph = new Map([
    ['a.ts', ['b.ts', 'c.ts']],
    ['b.ts', ['d.ts']],
    ['c.ts', ['d.ts']],
    ['d.ts', ['lib/x.ts']],
    ['lib/x.ts', []],
  ]);
  assert.deepEqual(findCycles(graph), []);
  graph.set('lib/x.ts', ['a.ts']);
  assert.deepEqual(findCycles(graph), [['a.ts', 'b.ts', 'd.ts', 'lib/x.ts', 'a.ts']]);
});

test('a layer may not import the layers its rules forbid', () => {
  const graph: ImportGraph = new Map([
    ['domain/rules.ts', ['domain/ports.ts', 'lib/errors.ts', 'storage/errors.ts']],
    ['storage/errors.ts', ['domain/ports.ts']],
  ]);
  assert.deepEqual(layerViolations(graph, { domain: ['storage'] }), ['domain/rules.ts -> storage/errors.ts']);
});

import { fileURLToPath } from 'node:url';
import { findCycles, layerViolations, readImportGraph, type LayerRules } from './import-graph.ts';

// Fails when the server's sources import each other in a cycle, or when the domain imports a layer
// its README rules out. `npm run lint` runs it.

const SOURCES = fileURLToPath(new URL('../packages/api/src/', import.meta.url));

/** The domain owns its model and ports; nothing it imports may come from the layers built on it. */
const RULES: LayerRules = {
  domain: ['storage', 'http', 'routes', 'services', 'presenters', 'auth', 'commands', 'app.ts', 'index.ts'],
};

const graph = readImportGraph(SOURCES);
const cycles = findCycles(graph);
const violations = layerViolations(graph, RULES);
for (const cycle of cycles) console.error(`Import cycle: ${cycle.join(' -> ')}`);
for (const violation of violations) console.error(`Layer violation: ${violation}`);
if (cycles.length || violations.length) process.exit(1);
console.log(`No import cycles or domain layer violations in ${graph.size} files.`);

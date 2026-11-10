import { fileURLToPath } from 'node:url';
import { findCycles, layerViolations, readImportGraph, type LayerRules } from './import-graph.ts';

// Fails when the server's sources import each other in a cycle, or when the domain or the services
// import a layer their READMEs rule out. `npm run lint` runs it.

const SOURCES = fileURLToPath(new URL('../packages/api/src/', import.meta.url));

/** The files at the top of `src`, which compose the layers. */
const ROOTS = ['app.ts', 'index.ts', 'reportRunners.ts', 'reportWorker.ts'];
/**
 * The domain owns its model and ports; nothing it imports may come from the layers built on it.
 * The services reach the database through the domain's ports only: the composition roots hand
 * them storage, the timer bus and the report placement.
 */
const RULES: LayerRules = {
  domain: ['storage', 'http', 'routes', 'services', 'presenters', 'auth', 'commands', ...ROOTS],
  services: ['storage', 'http', 'routes', 'auth', ...ROOTS],
};

const graph = readImportGraph(SOURCES);
const cycles = findCycles(graph);
const violations = layerViolations(graph, RULES);
for (const cycle of cycles) console.error(`Import cycle: ${cycle.join(' -> ')}`);
for (const violation of violations) console.error(`Layer violation: ${violation}`);
if (cycles.length || violations.length) process.exit(1);
console.log(`No import cycles or layer violations in ${graph.size} files.`);

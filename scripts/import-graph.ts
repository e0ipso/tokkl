import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/** Each source file and the files its relative imports name, type-only imports included. */
export type ImportGraph = Map<string, string[]>;

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)'(\.{1,2}\/[^']+)'/g;

/** The relative specifiers in a module's text: `import … from`, `export … from`, bare and dynamic imports. */
export function relativeSpecifiers(text: string): string[] {
  return [...text.matchAll(SPECIFIER)].map(match => match[1]!);
}

/** The graph of every `.ts` file under `root`, keyed by path relative to it, with `/` separators. */
export function readImportGraph(root: string): ImportGraph {
  const key = (path: string) => relative(root, path).split(sep).join('/');
  const graph: ImportGraph = new Map();
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    const path = join(entry.parentPath, entry.name);
    const imports = relativeSpecifiers(readFileSync(path, 'utf8')).map(spec => key(resolve(dirname(path), spec)));
    graph.set(key(path), imports);
  }
  return graph;
}

/** Every cycle a depth-first walk meets, each as the files around it with the first repeated last. */
export function findCycles(graph: ImportGraph): string[][] {
  const done = new Set<string>();
  const path: string[] = [];
  const cycles: string[][] = [];
  const visit = (file: string) => {
    path.push(file);
    for (const next of graph.get(file) ?? []) {
      if (!graph.has(next) || done.has(next)) continue;
      const start = path.indexOf(next);
      if (start >= 0) cycles.push([...path.slice(start), next]);
      else visit(next);
    }
    path.pop();
    done.add(file);
  };
  for (const file of [...graph.keys()].sort()) if (!done.has(file)) visit(file);
  return cycles;
}

/** A top-level directory and the top-level directories it must not import from. */
export type LayerRules = Record<string, readonly string[]>;

/** Imports that cross from a layer into one its rules forbid, as `from -> to`. */
export function layerViolations(graph: ImportGraph, rules: LayerRules): string[] {
  const layer = (file: string) => file.split('/')[0]!;
  const violations: string[] = [];
  for (const [file, imports] of graph)
    for (const target of imports)
      if (rules[layer(file)]?.includes(layer(target))) violations.push(`${file} -> ${target}`);
  return violations;
}

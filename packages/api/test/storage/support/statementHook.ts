import type { KyselyPlugin, OperationNode, QueryId, RawNode } from 'kysely';
import type { StorageConnection } from '../../../src/storage/connections.ts';
import type { PhysicalDatabase } from '../../../src/storage/physical.ts';

const isRaw = (node: OperationNode): node is RawNode => node.kind === 'RawNode';

/** Awaits `after` once each listed raw statement ran, so a test can pause a migration between DDL statements. */
export function afterStatements(
  connection: StorageConnection<PhysicalDatabase>,
  statements: readonly string[],
  after: (statement: string) => Promise<void>,
): StorageConnection<PhysicalDatabase> {
  const wanted = new Set(statements);
  const ran = new WeakMap<QueryId, string>();
  const plugin: KyselyPlugin = {
    transformQuery({ node, queryId }) {
      const text = isRaw(node) && !node.parameters.length ? node.sqlFragments.join('') : undefined;
      if (text !== undefined && wanted.has(text)) ran.set(queryId, text);
      return node;
    },
    async transformResult({ result, queryId }) {
      const statement = ran.get(queryId);
      if (statement !== undefined) await after(statement);
      return result;
    },
  };
  return {
    db: connection.db.withPlugin(plugin),
    backend: connection.backend,
    destination: connection.destination,
    readOnly: connection.readOnly,
    health: () => connection.health(),
    close: () => connection.close(),
  };
}

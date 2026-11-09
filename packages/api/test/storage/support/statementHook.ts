import type { KyselyPlugin, OperationNode, QueryId, RawNode } from 'kysely';
import type { StorageConnection } from '../../../src/storage/connections.ts';
import type { PhysicalDatabase } from '../../../src/storage/physical.ts';

const isRaw = (node: OperationNode): node is RawNode => node.kind === 'RawNode';

/**
 * The connection with a Kysely plugin that awaits `after` once each raw statement in `statements`
 * has run, before its caller sees the result. Migrations run their DDL as raw statements, so a test
 * can pause or stop one between two statements without a hook in the migrator.
 */
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

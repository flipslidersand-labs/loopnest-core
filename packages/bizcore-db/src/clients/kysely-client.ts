import {
  Kysely,
  PostgresDialect,
  KyselyPlugin,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryResult,
  UnknownRow,
  RootOperationNode,
} from 'kysely';
import { KyselyDatabase } from '../types/kysely-database.js';
import { pgPool, closePgPool } from './pg-client.js';

type QueryObserver = (kind: string, durationMs: number) => void;

let _observer: QueryObserver | null = null;

/** Register a callback invoked with (kind, durationMs) after every Kysely query. */
export function setKyselyQueryObserver(fn: QueryObserver): void {
  _observer = fn;
}

class TimingPlugin implements KyselyPlugin {
  private readonly starts = new WeakMap<object, number>();

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    this.starts.set(args.queryId, Date.now());
    return args.node;
  }

  async transformResult(
    args: PluginTransformResultArgs
  ): Promise<QueryResult<UnknownRow>> {
    const start = this.starts.get(args.queryId);
    if (start !== undefined) {
      if (_observer) {
        const kind = args.result.rows.length > 0 ? 'select' : 'mutation';
        _observer(kind, Date.now() - start);
      }
      this.starts.delete(args.queryId);
    }
    return args.result;
  }
}

// Reuses the shared pgPool (pg-client.ts) instead of creating a second Pool
// against the same DB — see #124.
export const kyselyDb = new Kysely<KyselyDatabase>({
  dialect: new PostgresDialect({ pool: pgPool }),
  plugins: [new TimingPlugin()],
});

export async function closeKysely() {
  await closePgPool();
}

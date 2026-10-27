import type { Logger } from 'pino';

/**
 * Log a startup failure through the structured logger, then exit non-zero.
 * Used for DB/Redis init failures and listen errors (e.g. EADDRINUSE) so the
 * operator sees a readable log line instead of a raw unhandled-rejection trace.
 */
export function fatalExit(
  log: Pick<Logger, 'fatal'>,
  msg: string,
  exit: (code: number) => unknown = process.exit,
) {
  return (err: unknown): void => {
    log.fatal({ err }, msg);
    exit(1);
  };
}

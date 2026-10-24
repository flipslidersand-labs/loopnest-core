import type { Response } from 'express';

/**
 * Thrown by `writeWithBackpressure` when the client went away (or the
 * response can no longer be written to) before the chunk could be flushed.
 */
export class ClientDisconnectedError extends Error {
  readonly code = 'ERR_CLIENT_DISCONNECTED';
  constructor(readonly originalError?: Error) {
    super('client disconnected before the response finished');
    this.name = 'ClientDisconnectedError';
  }
}

/**
 * Writes a chunk to `res` respecting backpressure: if the internal buffer is
 * over its high-water mark, `res.write()` returns false and we must wait for
 * the `drain` event before writing more (see Node's Writable stream docs).
 * Without this, a slow client lets the DB cursor race ahead and the full
 * result set piles up in the response buffer, defeating the point of
 * streaming from the DB in the first place.
 *
 * `drain` never fires once the client has disconnected, so waiting on it alone
 * would leave the caller (and, for streamed DB exports, the open transaction
 * and its pooled connection) stuck forever. We therefore race `drain` against
 * `close`/`error` and reject with `ClientDisconnectedError` in the latter
 * cases, which lets the caller's loop unwind. Whichever event settles first,
 * all three listeners are removed so nothing accumulates across chunks.
 */
export function writeWithBackpressure(res: Response, chunk: string): Promise<void> {
  if (res.destroyed || res.writableEnded) {
    return Promise.reject(new ClientDisconnectedError());
  }
  const ok = res.write(chunk);
  // write() on a connection that died underneath us can destroy `res` and
  // return false; 'close' has already fired, so waiting would hang forever.
  if (res.destroyed) return Promise.reject(new ClientDisconnectedError());
  if (ok) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      res.off('drain', onDrain);
      res.off('close', onClose);
      res.off('error', onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new ClientDisconnectedError());
    };
    const onError = (err: Error) => {
      cleanup();
      reject(new ClientDisconnectedError(err));
    };
    res.once('drain', onDrain);
    res.once('close', onClose);
    res.once('error', onError);
  });
}

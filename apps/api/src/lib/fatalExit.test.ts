import { describe, it, expect, vi } from 'vitest';
import { fatalExit } from './fatalExit.js';

describe('fatalExit', () => {
  it('logs the error at fatal level and exits with code 1', () => {
    const log = { fatal: vi.fn() };
    const exit = vi.fn();
    const err = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });

    fatalExit(log, 'server listen error', exit)(err);

    expect(log.fatal).toHaveBeenCalledWith({ err }, 'server listen error');
    expect(exit).toHaveBeenCalledWith(1);
  });
});

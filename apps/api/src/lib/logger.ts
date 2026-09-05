import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    base: { service: 'api' },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  isDev
    ? pino.transport({ target: 'pino-pretty', options: { colorize: true } })
    : undefined,
);

import pino from 'pino';

export const log = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: {
    paths: ['req.headers.authorization', '*.authorization', '*.token', '*.apiKey', '*.key'],
    remove: true,
  },
});


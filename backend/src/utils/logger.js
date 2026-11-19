const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const configuredLevel = String(process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')).toLowerCase();
const minimumLevel = LEVELS[configuredLevel] || LEVELS.info;
const jsonMode = process.env.LOG_FORMAT === 'json' || process.env.NODE_ENV === 'production';

function write(level, message, context = undefined) {
  if (LEVELS[level] < minimumLevel) return;

  if (jsonMode) {
    const payload = {
      time: new Date().toISOString(),
      level,
      message
    };
    if (context !== undefined) payload.context = context;
    const line = JSON.stringify(payload);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
    return;
  }

  const prefix = `[${level.toUpperCase()}] ${message}`;
  if (level === 'error') console.error(prefix, context ?? '');
  else if (level === 'warn') console.warn(prefix, context ?? '');
  else console.log(prefix, context ?? '');
}

export const logger = {
  debug: (message, context) => write('debug', message, context),
  info: (message, context) => write('info', message, context),
  warn: (message, context) => write('warn', message, context),
  error: (message, context) => write('error', message, context)
};

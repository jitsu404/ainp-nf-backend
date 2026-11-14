import path from 'node:path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { env, isProduction, isTest } from '../config/env.js';

const LOG_DIR = path.resolve(process.cwd(), 'logs');
const SENSITIVE_KEY = /pass(word)?|token|secret|authorization|cookie/i;
const REDACTED = '[REDACTED]';

const redactValue = (value: unknown, depth = 0): unknown => {
  if (depth > 5 || value === null || typeof value !== 'object' || value instanceof Error) return value;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : redactValue(inner, depth + 1),
    ]),
  );
};

/** Masks passwords, tokens and cookies anywhere in the log metadata. */
const redact = winston.format((info) => {
  for (const key of Object.keys(info)) {
    if (key === 'level' || key === 'message') continue;
    info[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactValue(info[key]);
  }
  return info;
});

const onlyLevel = (level: string) => winston.format((info) => (info.level === level ? info : false))();
const exceptLevel = (level: string) => winston.format((info) => (info.level === level ? false : info))();

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  redact(),
  winston.format.json(),
);

const rotating = (name: string, options: { level?: string; format: winston.Logform.Format }) =>
  new DailyRotateFile({
    dirname: LOG_DIR,
    filename: `${name}-%DATE%.log`,
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '14d',
    ...options,
  });

const appLevel = env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug');

const transports: winston.transport[] = [
  // Everything except HTTP access lines, at the configured level.
  rotating('app', { level: appLevel, format: winston.format.combine(exceptLevel('http'), fileFormat) }),
  rotating('error', { level: 'error', format: fileFormat }),
  // HTTP access log, fed by middlewares/httpLogger.ts.
  rotating('http', { level: 'http', format: winston.format.combine(onlyLevel('http'), fileFormat) }),
];

if (!isProduction) {
  transports.push(
    new winston.transports.Console({
      level: appLevel,
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        redact(),
        winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
          const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${String(timestamp)} ${level} ${String(message)}${extra}${stack ? `\n${String(stack)}` : ''}`;
        }),
      ),
    }),
  );
}

export const logger = winston.createLogger({
  // The logger itself passes everything down to "debug"; each transport applies its own level.
  level: 'debug',
  silent: isTest,
  transports,
  exitOnError: false,
});

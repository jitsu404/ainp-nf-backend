import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { isDBReady } from './config/db.js';
import { env, trustProxyHops } from './config/env.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { httpLogger } from './middlewares/httpLogger.js';
import { notFound } from './middlewares/notFound.js';
import { apiLimiter } from './middlewares/rateLimiter.js';
import { requestId } from './middlewares/requestId.js';
import { API_PREFIX, routes } from './routes.js';

/** Builds the Express app without starting it, so tests can drive it with supertest. */
export const createApp = (): Express => {
  const app = express();

  app.disable('x-powered-by');
  // Behind proxies (Render's load balancer, and Vercel when the client forwards /api to it): trust
  // that many X-Forwarded-For hops so req.ip, rate limits and audit IPs are the user's address.
  if (trustProxyHops > 0) app.set('trust proxy', trustProxyHops);

  // Order matters. See "Middleware order" in CLAUDE.md.
  app.use(requestId);
  app.use(helmet());
  // Content-Disposition is exposed so a cross-origin client can read download file names.
  // Every origin in CLIENT_ORIGIN may call the API with credentials (the session cookie).
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true, exposedHeaders: ['Content-Disposition'] }));

  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());
  app.use(httpLogger);

  // Health checks for the load balancer / uptime monitor. No auth, not rate limited.
  app.get('/health', (_req, res) => {
    res.json({ success: true, data: { status: 'ok', uptime: Math.round(process.uptime()) } });
  });
  app.get('/ready', (_req, res) => {
    const ready = isDBReady();
    res
      .status(ready ? 200 : 503)
      .json({ success: ready, data: { database: ready ? 'connected' : 'unavailable' } });
  });

  // Authenticated data must not be stored in browser or proxy caches (shared office PCs).
  app.set('etag', false);
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', apiLimiter);
  app.use(API_PREFIX, routes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
};

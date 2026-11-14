import type { Server } from 'node:http';
import { createApp } from './app.js';
import { connectDB, disconnectDB } from './config/db.js';
import { env } from './config/env.js';
import { devLog } from './utils/devLog.js';
import { logger } from './utils/logger.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;
let server: Server | undefined;
let shuttingDown = false;

/** Stops accepting requests, lets in-flight ones finish, closes the DB, then exits. */
const shutdown = async (reason: string, exitCode: number): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Shutting down (${reason})`);

  // If something hangs, don't wait forever.
  setTimeout(() => {
    logger.error('Forced exit: shutdown took too long');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  try {
    if (server)
      await new Promise<void>((resolve, reject) => server?.close((err) => (err ? reject(err) : resolve())));
    await disconnectDB();
  } catch (err) {
    logger.error('Error during shutdown', { err });
    exitCode = 1;
  }
  process.exit(exitCode);
};

process.on('SIGINT', () => void shutdown('SIGINT', 0));
process.on('SIGTERM', () => void shutdown('SIGTERM', 0));
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason });
  void shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { message: err.message, stack: err.stack });
  void shutdown('uncaughtException', 1);
});

try {
  await connectDB();
  server = createApp().listen(env.PORT, () => {
    logger.info(`API listening on port ${env.PORT}`, { env: env.NODE_ENV });
    // Forced: the start-up line is useful on stdout in every environment (e.g. container logs).
    devLog(`AINP-NF API ready on http://localhost:${env.PORT} (${env.NODE_ENV})`, true);
  });
} catch (err) {
  logger.error('Failed to start', { message: err instanceof Error ? err.message : String(err) });
  await shutdown('startup failure', 1);
}

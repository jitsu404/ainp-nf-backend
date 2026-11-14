import mongoose, { type ClientSession } from 'mongoose';
import { logger } from '../utils/logger.js';
import { env } from './env.js';

// Global Mongoose behaviour, applied before any model is compiled.
mongoose.set('strictQuery', true); // ignore filter keys that are not in the schema
mongoose.set('sanitizeFilter', true); // block $-operator injection through user input
mongoose.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret._id; // the `id` virtual replaces it
    return ret;
  },
});

mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
mongoose.connection.on('error', (err: unknown) => logger.error('MongoDB connection error', { err }));

export const connectDB = async (uri: string = env.MONGODB_URI): Promise<void> => {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
};

export const disconnectDB = async (): Promise<void> => {
  await mongoose.disconnect();
};

export const isDBReady = (): boolean =>
  mongoose.connection.readyState === mongoose.ConnectionStates.connected;

/**
 * Runs `fn` in a transaction: all writes commit together or none do.
 * Pass `session` to every query inside. Needs a replica set (see docker-compose.yml).
 */
export const withTransaction = <T>(fn: (session: ClientSession) => Promise<T>): Promise<T> =>
  mongoose.connection.transaction(fn);

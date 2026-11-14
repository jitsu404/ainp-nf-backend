// Runs before every test file: starts an in-memory MongoDB replica set (transactions need one)
// and sets the environment BEFORE any src module reads it.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll } from 'vitest';

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = replSet.getUri();
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.JWT_EXPIRES_IN = '1h';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';

beforeAll(async () => {
  const { connectDB } = await import('../src/config/db.js');
  await connectDB(replSet.getUri());
  // Build unique indexes up front so duplicate-key tests behave like production.
  await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()));
});

afterEach(async () => {
  const collections = await mongoose.connection.db?.collections();
  await Promise.all((collections ?? []).map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

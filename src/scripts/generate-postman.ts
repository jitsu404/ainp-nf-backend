// Writes the Postman collection for the API, generated from the live route table.
// Run with: npm run postman   → postman/ainp-nf-api.postman_collection.json
// Needs a valid .env (the route modules load config), but does not connect to MongoDB.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { buildPostmanCollection, countRequests } from '../docs/postman.js';
import { devLog } from '../utils/devLog.js';

const OUTPUT = path.resolve(process.cwd(), 'postman', 'ainp-nf-api.postman_collection.json');

const collection = buildPostmanCollection({ host: `http://localhost:${env.PORT}` });

await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(collection, null, 2)}\n`, 'utf8');

devLog(`Postman collection written to ${OUTPUT} (${countRequests(collection)} requests)`, true);

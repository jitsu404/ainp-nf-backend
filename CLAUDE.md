# CLAUDE.md — icar-nf-backend

REST API for the **AINP-Natural Farming Project Management System** (ICAR-IIFSR). The React client lives in `../client`.
The spec is the SOW PDF (Annexure I–III, Natural Farming section). Build Natural Farming first; ignore the AICRP-IFS section.

## Stack

- **Runtime:** Node.js 22 LTS.
- **Language:** TypeScript 6.0 in `strict` mode (plus `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), compiled as native ES modules (`"type": "module"`, `"module": "NodeNext"`).
  - Relative imports **must end in `.js`**, even though the source file is `.ts` (e.g. `import { env } from '../config/env.js'`). NodeNext requires this.
  - Type-only imports use `import type` / `import { type X }` (enforced by `verbatimModuleSyntax` and ESLint).
  - Stay on TypeScript 6.0.x: typescript-eslint does not support TypeScript 7 yet.
  - No `any`. Use `unknown` and narrow it. Infer DTO types from Zod (`z.output<typeof schema>`) instead of writing duplicate interfaces.
  - Development runs `.ts` directly with `tsx`. Production runs the compiled JavaScript from `dist/`.
- **Framework:** Express 5. Async handlers that throw or reject are forwarded to the error handler automatically, so no `asyncHandler` wrapper is needed.
- **Database:** MongoDB through Mongoose 9. The data model is still changing; keep it migration-friendly (see *Data rules*), because a later move to PostgreSQL is possible.
- **Validation:** Zod v4. Every request DTO and the environment config are Zod schemas.

## Commands

```bash
docker compose up -d   # local MongoDB 8 as a single-node replica set (needed for transactions)
npm run seed           # first Super Admin (SEED_SUPERADMIN_* in .env) + the 20 AINP-NF centres; safe to re-run
npm run migrate:user-fields   # one-off: old single-name accounts → title/first/middle/surname, phone → mobile (dry run; -- --apply to write)
npm run migrate:pi-seats      # one-off: active Centre PI accounts → seats (<code>.pi.npnf@icar.org.in; own email → contactEmail; dry run; -- --apply)
npm run postman        # regenerate postman/ainp-nf-api.postman_collection.json from the routes and DTOs
npm run dev            # cross-env NODE_ENV=development tsx watch src/server.ts
npm run build          # tsc -p tsconfig.build.json → dist/
npm start              # cross-env NODE_ENV=production node dist/server.js
npm run typecheck      # tsc --noEmit (src + tests)
npm test               # vitest run (in-memory MongoDB replica set, no real DB needed)
npm run lint           # eslint .
npm run format         # prettier --write .
```

Before calling any change done, run `npm run typecheck`, `npm run lint` and `npm test`.

## Folder structure

Feature-first modules. Shared plumbing lives outside `modules/`. **A module never imports another module's model**; it calls that module's service (e.g. users calls `centreExists()` from the centres service).

```
src/
├── server.ts                 # entry point: connect DB, listen, graceful shutdown, process-level error hooks
├── app.ts                    # createApp(): middleware order, health checks, routes, error handler (no listen())
├── routes.ts                 # API_MODULES: the one list used to mount routers AND generate Postman. Register modules here
├── config/
│   ├── env.ts                # loads .env, validates with Zod, exports frozen `env` + isProduction/isDevelopment/isTest
│   ├── db.ts                 # global Mongoose settings, connectDB/disconnectDB, isDBReady, withTransaction
│   └── constants.ts          # ROLES, CAPABILITIES, hasCapability, WORKFLOW_STATUSES, CENTRE_TYPES, AUTH_COOKIE
├── middlewares/
│   ├── requestId.ts          # req.id from a safe X-Request-Id or crypto.randomUUID(); echoed in the response header
│   ├── httpLogger.ts         # morgan → winston "http" level as structured JSON
│   ├── rateLimiter.ts        # apiLimiter (all /api) and loginLimiter (sign-in)
│   ├── authenticate.ts       # verifies the JWT cookie, re-loads the active user, sets req.user
│   ├── authorize.ts          # RBAC: authorize('centres.manage', ...)
│   ├── validate.ts           # validate(schemas) + getValidated<typeof schemas>(req)
│   ├── notFound.ts           # 404 for unmatched routes
│   └── errorHandler.ts       # the single global error handler (always registered last)
├── utils/
│   ├── logger.ts             # winston: rotating files + dev-only console, with secret redaction
│   ├── devLog.ts             # devLog(data, force = false): the only allowed console output
│   ├── AppError.ts           # operational error class + factory helpers
│   ├── response.ts           # ok / created / noContent envelope helpers, pageMeta
│   ├── validators.ts         # shared Zod pieces: objectId, idParams, listQuery(sortFields), skipFor
│   └── context.ts            # RequestContext, contextOf(req), scopeFilter, withScope (centre scoping)
├── types/
│   └── express.d.ts          # AuthUser; augments Express Request with id, user, validated
├── docs/                     # API documentation generator (see "Postman collection")
│   ├── routeMeta.ts          # tagHandler/readMeta, apiDoc({ name, description })
│   ├── routeInspector.ts     # collectRoutes(): walks the Express routers (only file touching router internals)
│   ├── schemaExample.ts      # Zod → JSON Schema → example values and field-rule text
│   └── postman.ts            # buildPostmanCollection()
├── scripts/
│   ├── seed.ts               # npm run seed
│   └── generate-postman.ts   # npm run postman
└── modules/
    ├── audit/                # recordAudit / recordAuthEvent (the only writers) + read-only GET /audit, /audit/export
    ├── auth/                 # login / logout / me
    ├── users/                # user administration (users.manage)
    └── centres/              # reference implementation of a full CRUD module. Copy its shape
        ├── centres.model.ts
        ├── centres.dto.ts          # Zod schemas, request-schema bundles, inferred DTO types
        ├── centres.service.ts      # business logic + DB access; no req/res here
        ├── centres.controller.ts   # thin: getValidated → service → response helper
        └── centres.routes.ts       # authenticate → authorize → validate → controller
tests/                        # setup.ts (in-memory replica set), helpers.ts, <feature>.test.ts
logs/                         # rotating log files (git-ignored)
dist/                         # compiled output (git-ignored)
```

**Layer rules:** routes → controller → service → model. Controllers never touch Mongoose. Services never touch `req`/`res`; they receive a `RequestContext` (from `contextOf(req)`) and throw `AppError` for expected failures.

## Middleware order (`app.ts`)

1. `requestId`
2. `helmet()`, `cors({ origin: env.CLIENT_ORIGIN, credentials: true })`, `compression()`
3. `express.json({ limit: '1mb' })`, `express.urlencoded(...)`, `cookieParser()`
4. `httpLogger`
5. `GET /health` (process up) and `GET /ready` (DB connected, else 503); no auth, not rate limited
6. `apiLimiter` on `/api` (`loginLimiter` is applied on the login route itself)
7. `app.use('/api/v1', routes)`
8. `notFound`
9. `errorHandler` (last)

`x-powered-by` is disabled. `trust proxy` is `TRUST_PROXY` hops (default 1 in production, 0 otherwise; set 2 when the Vercel client forwards `/api` to Render: Vercel + Render's load balancer), so `req.ip` and rate limits are correct behind the cloud load balancer. Rate limiters are skipped when `NODE_ENV=test`.

## Logging

### `utils/logger.ts`: winston, used for everything that must reach log files
- Levels: `error`, `warn`, `info`, `http`, `debug`. `LOG_LEVEL` overrides the default (`info` in production, `debug` otherwise).
- Rotating files (`winston-daily-rotate-file`: daily, zipped, 14 days kept, 20 MB max):
  - `logs/app-%DATE%.log`: every level **except** `http`, at `LOG_LEVEL`
  - `logs/error-%DATE%.log`: `error` only
  - `logs/http-%DATE%.log`: `http` only (fed by `httpLogger`)
- Files are JSON lines with timestamp, level, message and metadata (`requestId`, `userId` …); errors include `stack`.
- The colorized console transport is attached **only outside production**. The logger is silent when `NODE_ENV=test`.
- Keys matching `password|token|secret|authorization|cookie` are replaced with `[REDACTED]` at any depth. Still never log request bodies on auth routes.
- Always pass `requestId: req.id` (or `ctx.requestId`) in metadata so a request can be traced across log lines.

### `middlewares/httpLogger.ts`: HTTP request logging
morgan writes one JSON entry per request when the response finishes: `requestId`, `method`, `url`, `status`, `contentLength`, `responseTimeMs`, `ip`, `userId`, `userAgent`. Skips `/health`, `/ready`, and everything in tests.

### `utils/devLog.ts`: the only place `console.*` is allowed

```ts
// devLog(data, force = false)
// Prints only when NODE_ENV === 'development' (silent in production and test).
// force = true prints in every environment. Use sparingly, e.g. the start-up line or seed output.
devLog('Seeding centres');                   // development only
devLog(`API ready on ${env.PORT}`, true);    // always
devLog.warn('Deprecated param used');        // same rules, console.warn
devLog.error(err);                           // same rules, console.error
```

- `devLog` is for developer convenience only. Anything operational (errors, auth failures, workflow transitions) goes to `logger`.
- ESLint enforces `no-console` everywhere except `src/utils/devLog.ts`.

## Errors

### `utils/AppError.ts`
```ts
throw new AppError(404, 'OBSERVATION_NOT_FOUND', 'Observation not found');
throw AppError.badRequest('INVALID_STATUS', 'Only Draft or Returned records can be edited', details);
// helpers: badRequest 400, unauthorized 401, forbidden 403, notFound 404, conflict 409
```
Fields: `statusCode`, `code` (UPPER_SNAKE, stable, for the client), `message` (human-readable), `details` (optional), `isOperational = true`. Always create a new instance; never reuse one across requests.

### `middlewares/errorHandler.ts`: one global handler that normalizes everything
| Source | Status | `code` |
|---|---|---|
| `AppError` | its own | its own |
| `ZodError` (should not normally escape `validate`) | 400 | `VALIDATION_ERROR`, `details` from `z.flattenError()` |
| Mongoose `ValidationError` | 400 | `VALIDATION_ERROR`, `details.fields` |
| Mongoose `CastError` | 400 | `INVALID_ID` |
| Mongo duplicate key `11000` | 409 | `DUPLICATE`, `details.fields` |
| `TokenExpiredError` / `JsonWebTokenError` | 401 | `TOKEN_EXPIRED` / `INVALID_TOKEN` |
| body-parser `entity.parse.failed` / `entity.too.large` | 400 / 413 | `MALFORMED_JSON` / `PAYLOAD_TOO_LARGE` |
| anything else | 500 | `INTERNAL_ERROR` (generic message; real message only in the log) |

- 5xx is logged with `logger.error` (with stack); 4xx with `logger.warn`.
- `stack` is included in responses only outside production.
- `server.ts` handles `SIGINT`/`SIGTERM` (graceful: stop accepting, finish in-flight, close DB, 10 s hard limit) and `unhandledRejection`/`uncaughtException` (log, then shut down with exit code 1).

## Response envelope

```json
{ "success": true,  "data": { }, "meta": { "page": 1, "limit": 20, "total": 134, "pages": 7 } }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "…", "details": { }, "requestId": "…" } }
```
Send responses only through `utils/response.ts` (`ok`, `created`, `noContent`) or the error handler. Documents serialize with `id` (no `_id`, no `__v`), and users never include `passwordHash`.

## Validation (Zod DTOs)

Each `<feature>.dto.ts` defines Zod schemas and exports **request-schema bundles** plus inferred types:

```ts
export const createCentreSchemas = { body: centreBody } satisfies RequestSchemas;
export const updateCentreSchemas = { params: idParams, body: updateCentreBody } satisfies RequestSchemas;
export type CreateCentreDto = z.output<typeof centreBody>;

// routes:      router.post('/', authorize('centres.manage'), validate(createCentreSchemas), controller.create);
// controller:  const { body } = getValidated<typeof createCentreSchemas>(req);   // fully typed
```

- `validate` parses `params`, `query` and `body`, collects every failure, and throws `400 VALIDATION_ERROR` with `details.{part}.fieldErrors`.
- Parsed (coerced, defaulted, stripped) values go on **`req.validated`**. Express 5 makes `req.query` read-only, so never reassign it. Controllers read only through `getValidated`, never from raw `req.body` / `req.query`.
- Body schemas use `.strict()` so unknown keys are rejected rather than silently stored.
- List endpoints use `listQuery([...allowed sort fields])`: `page`, `limit` (max 100), and `sort` restricted to the allowlist (`-field` for descending).
- Use `objectId` / `idParams` from `utils/validators.ts`; `z.stringbool()` for boolean query params.
- Env config (`config/env.ts`) keys: `NODE_ENV`, `PORT`, `MONGODB_URI`, `JWT_SECRET` (min 32 chars), `JWT_EXPIRES_IN` (`8h`, `30m`, `1d`; parsed to seconds), `CLIENT_ORIGIN`, optional `LOG_LEVEL`, optional `TRUST_PROXY` (proxy hops, see Middleware order), optional `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. Invalid config stops the process at start-up.

## Authentication and RBAC

- `POST /api/v1/auth/login` sets the JWT (HS256) in the `nf_session` cookie: **httpOnly, SameSite=Strict, Secure in production**, never in the response body or localStorage. `POST /auth/logout` clears it. Login and `GET /auth/me` return the **session**: `{ user, role: { id, label, scope }, capabilities, assignableRoles, mustChangePassword }`. The client takes roles and permissions from this, never from a hardcoded copy.
- **Temporary passwords:** accounts created by someone else (and password resets) get `mustChangePassword: true`. Until the user calls `POST /auth/change-password`, `authenticate` answers every request with 403 `PASSWORD_CHANGE_REQUIRED`. Only `/auth/me`, `/auth/change-password` and `/auth/logout` use `authenticateAllowingPasswordChange`.
- **Password changes end sessions:** tokens issued before `passwordChangedAt` get 401 `SESSION_EXPIRED`. `change-password` issues a fresh cookie for the caller.
- SameSite=Strict means the client and API must be served from the **same site** (same registrable domain, e.g. `nf.example.in` and `api.nf.example.in`). A client on a different domain (such as a `*.vercel.app` URL) will not send the cookie.
- Passwords: bcryptjs, cost 12; at least 10 characters with a letter and a digit. Login compares against a dummy hash when the email is unknown, and returns the same `INVALID_CREDENTIALS` error either way, so accounts can't be discovered by timing or message.
- `authenticate` re-reads the user on every request: deactivating an account or changing its role takes effect immediately. It sets `req.user = { id, roleId, centreId, experimentIds, name, mustChangePassword }` (`experimentIds`: the experiments an Experiment PI seat leads, or for a Centre PI the experiments their centre has a trial in; re-read every request).
- Server source of truth for roles and capabilities: `config/constants.ts`. The client reads them from the session (`/auth/me`).
- `authorize(...capabilities)` → 403 `FORBIDDEN` unless the role has **at least one** of them. Always check capabilities, never role ids, so a role can change without code changes.
- **Roles (this phase): `superadmin`, `pc`, `epi`, `pi`.** Finance and data entry roles are added together with their modules, not before.
  - **Super Admin** (`superadmin`): the system owner. Every capability, including any added later. Created by `npm run seed`. Keep to one or two accounts; audited like everyone else.
  - **PCU** (`pc`): the top of the client's own hierarchy. For daily work it is the **same level as Super Admin**: both create and edit centres (`centres.manage`), create experiments and assign their centres and Experiment PIs (`research.assign`), assign Centre PIs, and approve data.
  - **Experiment PI** (`epi`): owns one experiment's definition (`research.config`), scope `experiment`: sees only the experiment linked to their seat, its trials, sheets, results and metadata (read-only for centre data). Can't create experiments, assign centres or the PI (`research.assign`), or edit trials.
  - **Centre PI** (`pi`): the agronomist in charge of one centre. Centre-scoped. **Exactly one active PI per centre**, enforced in the service (409 `CENTRE_HAS_PI`) and by the unique partial index `one_active_pi_per_centre`.
- **Who manages which accounts** is `ASSIGNABLE_ROLES` (checked in `users.service`, 403 `ROLE_NOT_ASSIGNABLE`): Super Admin → superadmin, pc, epi, pi; PCU → epi and pi. A role can see, edit, deactivate and reset **exactly** the roles it can create (others get 404). So only Super Admin manages PCU accounts, and PCU users can't grant themselves access. Nobody can deactivate or reset their own account.
- **PI accounts are seats** (`seatKind`): a permanent login held by one person at a time. `email` is the seat's login and never changes; the name parts, designation, mobile, organization and `contactEmail` (the person's own email) belong to the current holder. Replacing the holder moves them to `pastOccupants` (with the reason), replaces the password (which ends the old holder's sessions) and keeps everything recorded under the seat. Seats don't force a password change (`mustChangePassword: false`); the holder may change it later. Use `contactEmailOf(user)` wherever a person's email is shown, and `seatSummary` / `seatHistory` for responses.
  - **Experiment PI seats:** `pi<n>.npnf@icar.org.in` (`seatNumber`, never reused; unique index), created by the PCU (`POST /experiment-pis`, the `experimentPis` module composes users + experiments). An experiment links one with `piUserId` (optional at creation, changeable later, `research.assign`); a seat leads one experiment at a time (409 `PI_ALREADY_LINKED`, unique index `one_experiment_per_pi`). `POST /experiment-pis/:id/replace` gives the seat to a new person; `PATCH /experiment-pis/:id` corrects the holder's details.
  - **Centre PI seats:** `<centre code>.pi.npnf@icar.org.in`. `POST /centres/:id/pi` creates the seat or gives it to a new person (`reason` required when someone holds it); an old non-seat PI account is deactivated instead. `GET /centres/:id/pis` lists everyone who held it (current first). Centre responses include `currentPi` (`loginEmail` + holder). Existing accounts are converted by `npm run migrate:pi-seats`.
- **Person details follow the PCU master table ("Users" sheet):** `title` (Dr / Prof / Mr / Mrs / Ms), `firstName`, `middleName?`, `surname?`, `designation`, `email`, `mobile` (Indian 10-digit, optional +91 / 0), `organization`. They are required by the DTOs (`personFields` in `users.dto.ts`). `name` is the display name ("Dr. Sujit Kumar Singh"), **always built from the parts** by a `pre('validate')` hook (`users.names.ts`). Never accept or set `name` directly, and change name parts only via `save()` (not `updateOne` / `findOneAndUpdate`), so the hook runs. Accounts created before these fields existed are converted by `npm run migrate:user-fields` (dry run; add `-- --apply`).
- **People are never deleted**, only deactivated (`deactivatedAt`, `deactivatedBy`, `deactivationReason`). Data belongs to the centre, not the person, so a new PI sees the centre's history.
  - Any future endpoint that changes a user's role (edit, transfer, assignment) must apply the same `canAssignRole()` check.
- **Scoping** is enforced in services, never only in routes. Wrap every find/count/update filter with **`withScope(ctx.user, filter, centreField = 'centreId', experimentField = 'experimentId')`**: centre scope (`pi`) filters `centreField` to the user's centre; experiment scope (`epi`) filters `experimentField` to `experimentIds`. The default fails closed (a collection without `experimentId` returns nothing to an Experiment PI); pass `null` only for collections they may read in full (`centres`: `withScope(ctx.user, f, '_id', null)`; experiments use `'centreIds', '_id'`). It joins the filters with `$and`. **Never spread a scope filter into another filter** (`{ _id: id, ...scope }`): a shared key silently overwrites the other, and that bug once let a PI's request for another centre return their own.
- A centre user asking for another centre's record gets **404, not 403**, so ids of other centres aren't confirmed.
- **Workflow transitions** (Draft → Submitted → Scrutinised → Approved, plus Returned/Resubmitted) are checked in services with a conditional update such as `findOneAndUpdate({ _id, status: expected }, …)` so concurrent actions can't both succeed. Approved records are locked against edits.

## Data rules (MongoDB, migration-friendly)

- One collection per entity, linked by ObjectId refs (`centreId`, `experimentId`, `sanctionId` …). Embed only child data that never stands alone (e.g. treatment rows inside an observation).
- Every schema: `{ timestamps: true }`, `createdBy` / `updatedBy` refs, `required` / `enum` / `min` / `max`, and explicit unique or compound indexes (e.g. `{ experimentId, fy, season }`).
- **Money is `Decimal128`**, never `Number`. Convert at the service boundary.
- Research parameters not yet approved by the Project Coordination Unit go in one `parameters` field (`Schema.Types.Mixed`); everything else stays strictly typed.
- Global Mongoose settings in `config/db.ts`: `strictQuery: true`, `sanitizeFilter: true` (blocks `$`-operator injection; `express-mongo-sanitize` doesn't work with Express 5), and a `toJSON` transform that removes `_id` / `__v`.
- **Because of `sanitizeFilter`, wrap every nested operator the server builds itself in `trusted()`** (`import { trusted } from 'mongoose'`): `{ roleId: trusted({ $in: roles }) }`. Without it Mongoose neutralises the operator and the query fails with a 400 cast error. Top-level `$and` / `$or` are fine. Never wrap anything that came from user input.
- Audit rows also store `userName`, a snapshot taken at the time, so records stay readable after people leave.
- User-supplied search text goes through `escapeRegex` before it becomes a `RegExp`.
- Use `findOneAndUpdate(..., { returnDocument: 'after', runValidators: true })`. The `new: true` option is deprecated in Mongoose 9.
- Multi-document writes run in **`withTransaction(async (session) => …)`** from `config/db.ts`, passing `session` to every query, e.g. a record plus its audit row, or a fund release plus its balance update. This needs a replica set: `docker compose up -d` locally, Atlas or an equivalent in production.
- **Audit:** every create/update calls `recordAudit(ctx, { action, module, entityId, centreId, changes? }, session)` inside the same transaction. Only `modules/audit/audit.service.ts` writes `auditlogs`; rows are never updated or deleted.
  - **Edits store old → new values, only for fields that changed:** take `const before = snapshot(doc, Object.keys(dto))` before changing the document, then pass `changes: fieldChanges(before, snapshot(doc, Object.keys(dto)))`. Never pass the DTO itself as `changes`.
  - **Always set `centreId`** when the record belongs to a centre: the audit list is centre-scoped, so a row without it is invisible to that centre's PI.
  - Sheet saves store `cells` (old → new per changed cell) and `source` (`form` / `excel`). Sign-in, failed sign-in (with the email tried) and sign-out use `recordAuthEvent` (module `auth`).
  - Reading: `GET /audit` (filters: person, role, centre, module, record via `entityId`, IST date range, text; paged, newest first) and `GET /audit/export` (Excel, up to 10,000 rows), both `audit.view`. A Centre PI sees only their own centre's rows.

## Postman collection (generated)

`postman/ainp-nf-api.postman_collection.json` is **generated; never edit it by hand**. Run `npm run postman` after changing routes or DTOs, and commit the result with the change.

How it works:
1. `authenticate`, `authorize(...)` and `validate(...)` tag the handlers they return with metadata (`docs/routeMeta.ts`): sign-in required, capability groups, Zod schemas. Tagging doesn't change request handling.
2. `collectRoutes(API_MODULES)` walks each module router's stack, so router-level middleware (`router.use(authenticate, …)`) is inherited by the routes after it.
3. Zod schemas become JSON Schema (`z.toJSONSchema`, input side), which provides example bodies, query parameters and a field table for each description.
4. `buildPostmanCollection()` writes folders per module, `{{baseUrl}}` URLs, path variables (`:id` → `{{centreId}}`), a test script on each **Create** request that saves the new id, a collection-level envelope check, and empty `loginEmail` / `loginPassword` variables. Secrets are never written to the file.

When adding routes:
- Register the module in `API_MODULES` (`name`, `prefix`, `singular`, `description`). The singular drives request names and the `<singular>Id` variable.
- Name controller functions `list`, `getById`, `create`, `update`, `remove` to get standard request names (and id capture on `create`). For anything else, add `apiDoc({ name, description })` at the start of the route's handler chain.
- If a guessed example would fail the field's rules (regexes, cross-field rules), add `.meta({ example })` to the Zod field; use `.meta({ description })` for notes. `tests/postman.test.ts` fails if any generated body doesn't pass its own schema.

## Testing

- `tests/setup.ts` starts a `MongoMemoryReplSet` per test file, sets env vars before any `src` import, syncs indexes, and empties collections after each test.
- `tests/helpers.ts`: `app`, `createCentre()`, `createUser(role, centreId)`, `signedInAgent(role, centreId)` (a supertest agent holding the session cookie).
- Every module needs, at minimum: a happy path, permission denied (403), centre-scope isolation where relevant, a validation failure (400), and a duplicate (409) where there's a unique index.

## Conventions

- File names: `<feature>.<layer>.ts` (`centres.service.ts`). Variables and functions: camelCase. Constants: UPPER_SNAKE.
- Read config only through `config/env.ts`; never read `process.env` elsewhere (only `tests/setup.ts` sets it).
- No secrets in the repo. `.env` is git-ignored; `.env.example` lists every key with dummy values.
- This folder is its own git repository. The parent `ainp-nf/` is not a repository.

- **Never put `.default()` on a field of a schema that is also used with `.partial()`** (update DTOs). Zod keeps the default inside `.partial()`, so a PATCH that omits the field silently resets it. That bug once reset experiments' treatments to `[]` and centres' type on every edit. Put defaults in the Mongoose model instead. Defaults inside array items are fine, because items are always sent whole.

## Research modules (experiments → trials → sheets)

- **Experiment** (`modules/experiments`): created by the PCU (`research.assign`), its definition edited by the PCU or its Experiment PI (`research.config`, scoped). Fields to know:
  - `code`: generated from the `experiment` counter (`AINP-NF-EXPT-001` …, `modules/counters`, atomic `$inc`) unless the create body gives one; it never changes.
  - `startYear` / `endYear`: calendar years (numbers; they are also the years sheets can be recorded for), with `startYearDate` / `endYearDate` computed for range queries. `experimentYears(experiment)` lists them (start to end); sheets outside them are refused (`YEAR_BEFORE_START` / `YEAR_AFTER_END`).
  - `seasons`: a map of season master code → master item ids (empty = any season). Read the codes with `experimentSeasonCodes(experiment)`, never `experiment.seasons` directly. The DTO also accepts a plain list of codes.
  - `defaultParameters`: the stored parameter list. Responses from `withParameterDetails` add `parameters` as a read-only alias (sheets and analysis use it); requests use only `defaultParameters`.
  - `centreIds` (assigned centres) and `piUserId` (the Experiment PI seat): only `research.assign` may change them. `centreIds` is a **cache of the active trials' centres**; the trials are the record (see Trial).
  - `mainPlotCount` / `subPlotCount` (≤ 10 each): the plot layout of split and strip plot (`DESIGNS_WITH_PLOTS`, both ≥ 1, else 400 `PLOT_COUNTS_REQUIRED`); 0 for every other design. **Each main × sub plot is a complete RBD**: every treatment × replication is recorded in every plot, so 2 × 2 plots × 3 treatments × 2 replications = 24 rows per parameter. Use `experimentPlots(experiment)` (`[{ mainPlot, subPlot }]`, one `{ null, null }` plot for other designs) and `plotLabel()` ("M1·S2"). What each main / sub plot stands for is `mainPlotData` / `subPlotData` (codes M1 … / S1 …, as many as the counts); `plotNames()` / `plotTitle()` ("M1 Conventional tillage · S2 Jeevamrit") give them to the analysis (`plots[].title`), its export and the Excel template (a name column beside each label, ignored on import).
  The protocol: Programme, design (RBD / Split plot / Strip plot / Non-replicated / Farmer participatory / Survey, as named in the Annual Report; RBD and Split plot need ≥ 2 replications, Strip plot may have none, the last three never have them), replications, common treatments (T1…), parameters from the library (each `plot`-level = per treatment × replication, or `treatment`-level = once per treatment, in every plot of the layout; `required` blocks submission), seasons, and assigned centres. Assigning centres creates their **trials**.
- **`dataLocked`**: set when any centre records data. After that the design, replications, main and sub plot counts and existing treatments/parameters can't change (409 `EXPERIMENT_HAS_DATA`); new ones can be added.
- **Assigning centres = trials.** A trial (unique per experiment × centre) is also the record of the assignment: `assignmentStatus` Active / Withdrawn, with `assignedAt/By`, `withdrawnAt/By`, `withdrawReason`. `syncTrials()` (trials service) is the only writer: a new centre gets a trial, a dropped one is **withdrawn** (never deleted), a re-added one gets its old trial back. It runs inside the experiment's create/update transaction (the controller passes it in as `SyncCentres`, because the trials service depends on the experiments service), audits each change with the centre's `centreId`, and returns the active centres, which become `centreIds`. Optional `withdrawReason` on the experiment PATCH is stored on the withdrawn trials.
  - A withdrawn trial is **read-only**: its setup, sheets (save, import, submit, return, approve, new sheets) and metadata refuse writes with 409 `TRIAL_WITHDRAWN` (`assertTrialActive` / `assertTrialIdActive`). It leaves the reporting grid, the cross-centre summary, pooled analysis, trend and metadata export.
  - **Centre PI scope for experiments comes from their trials**, withdrawn included: `authenticate` loads `experimentIds` with `experimentIdsAtCentre()`, so a withdrawn centre still reads its past experiment and data. A centre that never had a trial gets 404.
  - There is **no separate assignment collection**: an experiment × centre record is the trial.
- **Crops per season:** the experiment's `seasons` (season → crop master ids) are the default for every centre. A centre that grows something else (e.g. the crop isn't available locally) records it on its trial in `seasonCrops`, which holds **only the seasons it changed** (PATCH `/trials/:id` with `{ seasonCrops: { KHARIF: [ids] } }`; null goes back to the experiment's crops), so later changes to the experiment's crops still reach every centre that didn't change them. Seasons must be the protocol's, crops active `crop` master items. No approval: the change is recorded in the audit trail (`changes.seasonCrops`, old → new). Read the result with `trialSeasonCrops(experiment, trial)`; the trial detail returns it as `cropsBySeason` (`crops`, `defaultCrops`, `changed`).
- **Trial** (`modules/trials`, `research.enter`): the experiment at one centre. The centre sets cropping systems (crops and varieties per season, checked against the masters and the protocol's seasons), practice details per treatment, in-charge (must belong to the centre), layout notes and status.
- **Sheet** (`modules/sheets`): trial × **year** × season (× cropping system or crop), unique (`one_sheet_per_trial_season_year`). `year` is a number, the year the season starts in: Kharif 2026 and Rabi 2026 (harvested early 2027) are both 2026. Sheets don't store a financial-year code. Values live in `observations`, one row per plot × treatment × replication × parameter (`mainPlot` / `subPlot`, null for single-plot designs; `valueNumber` / `valueText`; unique index `one_value_per_plot_cell`).
  - Every cell is checked against the protocol and the library (`checkCell`). A batch with any error is rejected whole.
  - Workflow: Draft → Submitted (`research.submit`; fails with `INCOMPLETE_SHEET` listing missing required cells) → Returned (`research.review` / `research.approve`, remark required) or Approved (`research.approve`, locks). Transitions use conditional updates against races.
  - **The years come only from the experiment:** any year from its `startYear` to its `endYear` (`experimentYears`) can be recorded; sheets never look at the financial years master (that stays for the budget module). What locks data is the sheet's own workflow (Submitted / Approved) and the experiment's status (new sheets need an Active experiment).
  - Excel template: a "Plot data" tab (treatment × replication rows, with Main plot and Sub plot columns for split / strip plot) and a "Treatment data" tab. Plots and replications are written as labels, `M1`, `S1`, `R1`; import also reads lower case and plain numbers, and reports a row whose label can't be read (e.g. `S1` in the Main plot column). Import checks every cell; dry run by default; empty cells clear values.
- **Analysis** (`sheets.analysis.ts`, pure and unit-tested against hand-worked and independently computed examples):
  - Per sheet: treatment means, grand mean and, for complete replicated data of an **RBD** experiment (in split and strip plot: of each plot, in `plots[]`, with `parameters` holding the means over all plots), the ANOVA (F, p via `jstat`), CV %, SEm±, SEd±, CD (5 %) and **DMRT letters** (`dmrtLetters`, Duncan at (1 − α)^(p − 1)), the last two only when significant. Other designs and per-treatment parameters get means with a `reason`.
  - Across centres (`GET /sheets/summary`, approved sheets): means per centre with the cropping-system name, and `pooledAnalysis` per per-plot parameter for single-plot designs (split and strip plot get the means over all their plots, no pooled analysis yet; combined RBD over locations, Gomez & Gomez: treatments vs T × L, or vs the pooled error when there is no interaction at all; Bartlett's test). The experiment's `referenceTreatmentCode` drives "% vs reference" in the client.
  - `sheets.reports.ts`: `GET /sheets/trend` (means per year of the experiment, future years without data left off, optionally one season or centre) and Excel exports (`/sheets/:id/analysis/export`, `/sheets/summary/export`). `GET /sheets/reporting` is the centre × year × season status grid.
- **Calculated parameters:** a library parameter with a `formula` (e.g. `NET_RETURNS / COST_CULTIVATION`; codes, numbers, `+ - * /`, brackets, `IFEMPTY(x, 0)`; parsed in `utils/formula.ts`, never `eval`). Checked on save: valid syntax, existing number parameters, no loops (400 `INVALID_FORMULA`). Values are **computed when a sheet is read** (`sheets.calculated.ts`), never stored or typed: a per-treatment formula over a per-plot input uses the treatment mean. They have no Excel column, don't count as required, and feed the analysis and summary like entered values. Seed sets the datasheet formulas (gross and net returns, B:C, season equivalent yield) once.
- **Spreading a Mongoose sub-document (`{...sub}`) does not copy its fields.** Copy fields explicitly or use `.toObject()`; this once dropped every parameter's `level`.
- **Metadata** (`modules/metadata`): the ICAR research-data metadata format (fields 1–38, no 19), one record per **trial** in `trialmetadata`. The field list lives only in `metadata.fields.ts`, and the client renders its forms from what the API returns. Each field has one source:
  - `common`: on the experiment (`experiment.metadata`), set by the PCU (`research.config`); null means the default.
  - `auto`: derived when read from the protocol, the trial's crops, the centre, its current PI and its sheets. Never stored.
  - `centre`: the centre's own record.
  Every centre assigned to the experiment can read the others' metadata (not their data), but only the owning centre can write it (scoped `getTrial` gives others 404). Workflow: Draft → Submitted (`research.submit`, `INCOMPLETE_METADATA` lists the required fields still missing) → Returned (remark required; Approved can be reopened) / Approved. `GET /metadata/experiments/:id/export` gives one row per centre in the ICAR column order.

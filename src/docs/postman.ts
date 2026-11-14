import { AUTH_COOKIE } from '../config/constants.js';
import { API_MODULES, API_PREFIX, type ApiModule } from '../routes.js';
import { type RouteInfo, collectRoutes } from './routeInspector.js';
import { type JsonSchema, describeRules, exampleFor, toJsonSchema, typeLabel } from './schemaExample.js';

// Builds a Postman Collection v2.1 from the live route table. See CLAUDE.md "Postman collection".

const SCHEMA_URL = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

interface PostmanScript {
  listen: 'test' | 'prerequest';
  script: { type: 'text/javascript'; exec: string[] };
}
interface PostmanQueryParam {
  key: string;
  value: string;
  description?: string;
  disabled?: boolean;
}
interface PostmanRequest {
  name: string;
  event?: PostmanScript[];
  request: {
    method: string;
    header: { key: string; value: string }[];
    body?: { mode: 'raw'; raw: string; options: { raw: { language: 'json' } } };
    url: {
      raw: string;
      host: string[];
      path: string[];
      query?: PostmanQueryParam[];
      variable?: { key: string; value: string; description?: string }[];
    };
    description: string;
  };
}
interface PostmanFolder {
  name: string;
  description: string;
  item: PostmanRequest[];
}
export interface PostmanCollection {
  info: { name: string; description: string; schema: string };
  item: PostmanFolder[];
  variable: { key: string; value: string; type: 'string'; description?: string }[];
  event: PostmanScript[];
}

export interface BuildOptions {
  /** Server origin used for the {{host}} variable, e.g. http://localhost:5000 */
  host: string;
}

const testScript = (lines: string[]): PostmanScript => ({
  listen: 'test',
  script: { type: 'text/javascript', exec: lines },
});

const idVariable = (module: ApiModule): string => `${module.singular}Id`;

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** "list" → "List centres", "getById" → "Get centre"; otherwise "someAction" → "Some action". */
const requestName = (route: RouteInfo): string => {
  if (route.meta.doc?.name) return route.meta.doc.name;
  const { name, singular } = route.module;
  switch (route.handlerName) {
    case 'list':
      return `List ${name.toLowerCase()}`;
    case 'getById':
      return `Get ${singular}`;
    case 'create':
      return `Create ${singular}`;
    case 'update':
      return `Update ${singular}`;
    case 'remove':
      return `Delete ${singular}`;
    default:
      return capitalise(route.handlerName.replace(/([A-Z])/g, ' $1').toLowerCase()) || route.path;
  }
};

const accessLine = (route: RouteInfo): string => {
  if (!route.meta.requiresAuth) return '**Access:** public (no sign-in needed)';
  const groups = (route.meta.capabilityGroups ?? []).map(
    (group) => (group.length > 1 ? 'one of ' : '') + group.map((c) => `\`${c}\``).join(', '),
  );
  return groups.length
    ? `**Access:** signed in, and the role needs ${groups.join(' and ')}`
    : '**Access:** any signed-in user';
};

const fieldTable = (title: string, schema: JsonSchema): string => {
  const props = Object.entries(schema.properties ?? {});
  if (props.length === 0) return '';
  const required = new Set(schema.required ?? []);
  const rows = props.map(
    ([name, prop]) =>
      `| \`${name}\` | ${typeLabel(prop)} | ${required.has(name) ? 'yes' : 'no'} | ${describeRules(prop) || '—'} | ${prop.description ?? ''} |`,
  );
  return [
    `**${title}**`,
    '',
    '| Field | Type | Required | Rules | Notes |',
    '|---|---|---|---|---|',
    ...rows,
    ...(schema.additionalProperties === false ? ['', 'Unknown fields are rejected.'] : []),
  ].join('\n');
};

const queryParams = (schema: JsonSchema | undefined): PostmanQueryParam[] => {
  if (!schema?.properties) return [];
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties).map(([key, prop]) => {
    // Pre-fill only parameters that have a default or are required; the rest are listed but disabled.
    const active = required.has(key) || prop.default !== undefined;
    return {
      key,
      value: active ? String(exampleFor(prop, key)) : '',
      description: [typeLabel(prop), describeRules(prop), prop.description].filter(Boolean).join(' · '),
      disabled: !active,
    };
  });
};

const buildRequest = (route: RouteInfo): PostmanRequest => {
  const { module, meta } = route;
  const schemas = meta.schemas ?? {};
  const bodySchema = schemas.body ? toJsonSchema(schemas.body) : undefined;
  const querySchema = schemas.query ? toJsonSchema(schemas.query) : undefined;
  const paramsSchema = schemas.params ? toJsonSchema(schemas.params) : undefined;

  const pathSegments = [module.prefix, route.path]
    .join('/')
    .split('/')
    .filter((segment) => segment.length > 0);
  const query = queryParams(querySchema);
  const activeQuery = query.filter((q) => !q.disabled);
  const queryString = activeQuery.length ? `?${activeQuery.map((q) => `${q.key}=${q.value}`).join('&')}` : '';

  // Express ":id" segments become Postman path variables, pre-filled with e.g. {{centreId}}.
  const pathVariables = pathSegments
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => {
      const key = segment.slice(1);
      const prop = paramsSchema?.properties?.[key];
      return {
        key,
        value: key === 'id' ? `{{${idVariable(module)}}}` : `{{${key}}}`,
        ...(prop && { description: describeRules(prop) }),
      };
    });

  const tests: string[] = [];
  if (route.handlerName === 'create') {
    tests.push(
      `// Remember the new ${module.singular} so "Get", "Update" and other requests can use it.`,
      'if (pm.response.code === 201) {',
      `  pm.collectionVariables.set('${idVariable(module)}', pm.response.json().data.id);`,
      '}',
    );
  }
  if (meta.doc?.name === 'Sign in') {
    tests.push(
      "pm.test('Session cookie is set', () => {",
      `  pm.expect(pm.cookies.has('${AUTH_COOKIE}')).to.be.true;`,
      '});',
    );
  }

  const description = [
    meta.doc?.description,
    accessLine(route),
    `**Endpoint:** \`${route.method} ${API_PREFIX}${module.prefix}${route.path === '/' ? '' : route.path}\``,
    bodySchema && fieldTable('Body', bodySchema),
    querySchema && fieldTable('Query parameters', querySchema),
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    name: requestName(route),
    ...(tests.length && { event: [testScript(tests)] }),
    request: {
      method: route.method,
      header: bodySchema ? [{ key: 'Content-Type', value: 'application/json' }] : [],
      ...(bodySchema && {
        body: {
          mode: 'raw' as const,
          raw: JSON.stringify(exampleFor(bodySchema), null, 2),
          options: { raw: { language: 'json' as const } },
        },
      }),
      url: {
        raw: `{{baseUrl}}/${pathSegments.join('/')}${queryString}`,
        host: ['{{baseUrl}}'],
        path: pathSegments,
        ...(query.length && { query }),
        ...(pathVariables.length && { variable: pathVariables }),
      },
      description,
    },
  };
};

const systemFolder = (): PostmanFolder => {
  const simpleGet = (name: string, path: string, description: string): PostmanRequest => ({
    name,
    request: {
      method: 'GET',
      header: [],
      url: { raw: `{{host}}/${path}`, host: ['{{host}}'], path: [path] },
      description: `${description}\n\n**Access:** public`,
    },
  });
  return {
    name: 'System',
    description: 'Health checks for load balancers and uptime monitors. Not under /api/v1.',
    item: [
      simpleGet('Health', 'health', 'Returns 200 while the process is running.'),
      simpleGet('Readiness', 'ready', 'Returns 200 when the database is connected, otherwise 503.'),
    ],
  };
};

const COLLECTION_DESCRIPTION = `REST API for the AINP-Natural Farming Project Management System (ICAR-IIFSR).

**Generated file: do not edit by hand.** Run \`npm run postman\` in icar-nf-backend after changing routes or DTOs.

### Getting started
1. Set the \`loginEmail\` and \`loginPassword\` collection variables (for example, the seeded Super Administrator from \`.env\`).
2. Run **Auth → Sign in**. The API returns an httpOnly \`${AUTH_COOKIE}\` cookie; Postman stores it and sends it with every later request automatically.
3. **Create** requests save the new record's id in a variable (e.g. \`centreId\`), which **Get** and **Update** requests then use.

### Conventions
- Success: \`{ "success": true, "data": …, "meta"? }\`. Failure: \`{ "success": false, "error": { "code", "message", "details"?, "requestId" } }\`.
- Every response has an \`X-Request-Id\` header; quote it when reporting a problem so it can be found in the server logs.
- Each request's description lists who may call it and every field with its validation rules.`;

/** Builds the collection from the same route table the server mounts. */
export const buildPostmanCollection = ({ host }: BuildOptions): PostmanCollection => {
  const routes = collectRoutes(API_MODULES);

  const folders = API_MODULES.map((module) => ({
    name: module.name,
    description: module.description,
    item: routes.filter((route) => route.module === module).map(buildRequest),
  }));

  return {
    info: { name: 'AINP-NF API', description: COLLECTION_DESCRIPTION, schema: SCHEMA_URL },
    item: [systemFolder(), ...folders],
    variable: [
      { key: 'host', value: host, type: 'string', description: 'Server origin' },
      { key: 'baseUrl', value: `{{host}}${API_PREFIX}`, type: 'string', description: 'API root' },
      { key: 'loginEmail', value: '', type: 'string', description: 'Used by Auth → Sign in' },
      { key: 'loginPassword', value: '', type: 'string', description: 'Used by Auth → Sign in' },
      ...API_MODULES.filter((module) =>
        routes.some((r) => r.module === module && r.handlerName === 'create'),
      ).map((module) => ({
        key: idVariable(module),
        value: '',
        type: 'string' as const,
        description: `Set automatically by "Create ${module.singular}"`,
      })),
    ],
    // Runs after every request: checks the response follows the API envelope.
    event: [
      testScript([
        "pm.test('Response follows the API envelope', () => {",
        '  if (pm.response.code === 204) return;',
        '  const body = pm.response.json();',
        '  pm.expect(body.success).to.equal(pm.response.code < 400);',
        '});',
      ]),
    ],
  };
};

/** Total number of requests in a collection (for logging). */
export const countRequests = (collection: PostmanCollection): number =>
  collection.item.reduce((sum, folder) => sum + folder.item.length, 0);

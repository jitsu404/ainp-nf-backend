import { describe, expect, it } from 'vitest';
import { buildPostmanCollection } from '../src/docs/postman.js';
import { collectRoutes } from '../src/docs/routeInspector.js';
import { API_MODULES } from '../src/routes.js';

const collection = buildPostmanCollection({ host: 'http://localhost:5000' });
const routes = collectRoutes(API_MODULES);
const requests = collection.item.flatMap((folder) =>
  folder.item.map((item) => ({ folder: folder.name, ...item })),
);
const find = (folder: string, name: string) => {
  const found = requests.find((r) => r.folder === folder && r.name === name);
  if (!found) throw new Error(`Request "${folder} → ${name}" not found`);
  return found;
};

/** Replaces Postman {{variables}} with values that are valid for the API. */
const fillVariables = (raw: string): string =>
  raw
    .replace(/\{\{loginEmail\}\}/g, 'admin@example.com')
    .replace(/\{\{loginPassword\}\}/g, 'Password12345')
    .replace(/\{\{\w+Id\}\}/g, '0123456789abcdef01234567');

describe('Postman generator', () => {
  it('reads every route from the Express routers (guards against router internals changing)', () => {
    const summary = routes.map((r) => `${r.method} ${r.module.prefix}${r.path === '/' ? '' : r.path}`);
    expect(summary).toEqual(
      expect.arrayContaining([
        'POST /auth/login',
        'POST /auth/logout',
        'GET /auth/me',
        'GET /users',
        'POST /users',
        'GET /centres',
        'GET /centres/:id',
        'POST /centres',
        'PATCH /centres/:id',
        'GET /centres/:id/pis',
        'POST /centres/:id/pi',
        'POST /auth/change-password',
        'PATCH /users/:id',
        'POST /users/:id/deactivate',
        'POST /users/:id/activate',
        'POST /users/:id/reset-password',
      ]),
    );
    expect(requests).toHaveLength(routes.length + 2); // + the two System health checks
  });

  it('picks up authentication and capabilities from the middleware chain', () => {
    const login = routes.find((r) => r.module.prefix === '/auth' && r.path === '/login');
    const createCentre = routes.find((r) => r.module.prefix === '/centres' && r.method === 'POST');
    const listUsers = routes.find(
      (r) => r.module.prefix === '/users' && r.method === 'GET' && r.path === '/',
    );

    expect(login?.meta.requiresAuth).toBeFalsy();
    expect(createCentre?.meta).toMatchObject({ requiresAuth: true, capabilityGroups: [['centres.manage']] });
    // Inherited from router.use(authenticate, authorize('users.manage')).
    expect(listUsers?.meta).toMatchObject({ requiresAuth: true, capabilityGroups: [['users.manage']] });
  });

  it('generates example bodies that pass their own Zod schemas', () => {
    const withBodies = routes.filter((r) => r.meta.schemas?.body);
    expect(withBodies.length).toBeGreaterThan(0);

    for (const route of withBodies) {
      // Match on method + exact path, since a module has several POST routes.
      const path = `${route.module.prefix}/${route.path}`.split('/').filter(Boolean).join('/');
      const request = requests.find(
        (r) => r.request.method === route.method && r.request.url.path.join('/') === path,
      );
      const raw = request?.request.body?.raw;
      expect(raw, `${route.method} ${route.module.prefix}${route.path} has a body`).toBeDefined();
      const result = route.meta.schemas?.body?.safeParse(JSON.parse(fillVariables(raw ?? '{}')));
      expect(
        result?.success,
        `${route.method} ${route.module.prefix}${route.path}: ${result?.error?.message}`,
      ).toBe(true);
    }
  });

  it('wires ids, path variables and query defaults', () => {
    const getCentre = find('Centres', 'Get centre');
    expect(getCentre.request.url.raw).toBe('{{baseUrl}}/centres/:id');
    expect(getCentre.request.url.variable).toEqual([
      expect.objectContaining({ key: 'id', value: '{{centreId}}' }),
    ]);

    const createCentre = find('Centres', 'Create centre');
    expect(createCentre.event?.[0]?.script.exec.join('\n')).toContain("set('centreId'");

    const listCentres = find('Centres', 'List centres');
    expect(listCentres.request.url.raw).toBe('{{baseUrl}}/centres?page=1&limit=20');
    expect(listCentres.request.url.query?.find((q) => q.key === 'search')?.disabled).toBe(true);
  });

  it('documents access rules and fields in each request description', () => {
    expect(find('Centres', 'Create centre').request.description).toContain('`centres.manage`');
    expect(find('Centres', 'Create centre').request.description).toContain('| `code` | string | yes |');
    expect(find('Auth', 'Sign in').request.description).toContain('public');
    expect(find('Auth', 'Current session').request.description).toContain('any signed-in user');
    expect(find('Centres', 'Assign centre PI').request.description).toContain('`users.manage`');
  });

  it('declares the collection variables the requests use', () => {
    const keys = collection.variable.map((v) => v.key);
    expect(keys).toEqual(
      expect.arrayContaining(['host', 'baseUrl', 'loginEmail', 'loginPassword', 'centreId', 'userId']),
    );
    expect(collection.variable.find((v) => v.key === 'loginPassword')?.value).toBe('');
  });
});

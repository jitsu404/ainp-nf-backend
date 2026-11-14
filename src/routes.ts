import { Router } from 'express';
import { authRouter } from './modules/auth/auth.routes.js';
import { centresRouter } from './modules/centres/centres.routes.js';
import { usersRouter } from './modules/users/users.routes.js';

export const API_PREFIX = '/api/v1';

export interface ApiModule {
  /** Folder name in the generated Postman collection. */
  name: string;
  /** Mount path under API_PREFIX. */
  prefix: string;
  router: Router;
  /** Singular noun, used for request names ("Create centre") and the id variable ("centreId"). */
  singular: string;
  description: string;
}

/**
 * Every module router. This is the single list used both to mount the API and to generate
 * the Postman collection, so add new modules here and nowhere else.
 */
export const API_MODULES: readonly ApiModule[] = [
  {
    name: 'Auth',
    prefix: '/auth',
    router: authRouter,
    singular: 'session',
    description: 'Sign in and out. The session is an httpOnly cookie that Postman stores and resends.',
  },
  {
    name: 'Users',
    prefix: '/users',
    router: usersRouter,
    singular: 'user',
    description:
      'User accounts. Needs `users.manage`; each role can only create the roles it is allowed to (only the PCU and Super Administrator create PI and data-entry accounts).',
  },
  {
    name: 'Centres',
    prefix: '/centres',
    router: centresRouter,
    singular: 'centre',
    description:
      'Network and voluntary centres. Only the PCU and Super Administrator create or edit them (`centres.manage`). Everyone signed in can read them; PI and data-entry users see only their own centre.',
  },
];

export const routes = Router();

for (const module of API_MODULES) routes.use(module.prefix, module.router);

import request from 'supertest';
import { createApp } from '../src/app.js';
import type { RoleId } from '../src/config/constants.js';
import { CentreModel } from '../src/modules/centres/centres.model.js';
import { UserModel } from '../src/modules/users/users.model.js';
import { hashPassword } from '../src/modules/users/users.service.js';

export const app = createApp();

export const TEST_PASSWORD = 'TestPassword123';
let counter = 0;

/** 1 → 'A', 27 → 'AA': unique name suffixes made of letters (name fields reject digits). */
export const letters = (n: number): string =>
  (n > 26 ? letters(Math.floor((n - 1) / 26)) : '') + String.fromCharCode(65 + ((n - 1) % 26));

export const createCentre = (overrides: Partial<{ code: string; name: string; state: string }> = {}) => {
  counter += 1;
  return CentreModel.create({
    code: `C${String.fromCharCode(65 + (counter % 26))}${String.fromCharCode(65 + Math.floor(counter / 26))}`,
    name: `Centre ${counter}`,
    host: 'Test University',
    state: 'Uttar Pradesh',
    ...overrides,
  });
};

/** Creates a user directly in the database. By default they have already chosen their own password. */
export const createUser = async (
  roleId: RoleId,
  centreId: string | null = null,
  { mustChangePassword = false }: { mustChangePassword?: boolean } = {},
) => {
  counter += 1;
  return UserModel.create({
    title: 'Dr',
    firstName: 'User',
    surname: `Test${letters(counter)}`,
    designation: 'Scientist',
    organization: 'Test University',
    email: `user${counter}@test.local`,
    passwordHash: await hashPassword(TEST_PASSWORD),
    roleId,
    centreId,
    mustChangePassword,
  });
};

export const signIn = async (email: string, password = TEST_PASSWORD) => {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password });
  return { agent, res };
};

/** Signs in as a new user with the given role and returns an agent that keeps the session cookie. */
export const signedInAgent = async (roleId: RoleId, centreId: string | null = null) => {
  const user = await createUser(roleId, centreId);
  const { agent, res } = await signIn(user.email);
  if (res.status !== 200) throw new Error(`Login failed in test helper: ${res.status}`);
  return { agent, user };
};

let personCounter = 0;
/** Body for "create user" / "assign Centre PI". */
export const newPerson = (extra: Record<string, unknown> = {}) => {
  personCounter += 1;
  return {
    title: 'Dr',
    firstName: 'Person',
    surname: `Test${letters(personCounter)}`,
    designation: 'Agronomist',
    email: `person${personCounter}@test.local`,
    mobile: '+91 98765 43210',
    organization: 'Test University',
    temporaryPassword: 'Temporary12345',
    ...extra,
  };
};

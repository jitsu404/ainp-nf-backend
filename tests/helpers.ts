import request from 'supertest';
import { createApp } from '../src/app.js';
import type { RoleId } from '../src/config/constants.js';
import { CentreModel } from '../src/modules/centres/centres.model.js';
import { UserModel } from '../src/modules/users/users.model.js';
import { hashPassword } from '../src/modules/users/users.service.js';

export const app = createApp();

export const TEST_PASSWORD = 'TestPassword123';
let counter = 0;

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

export const createUser = async (roleId: RoleId, centreId: string | null = null) => {
  counter += 1;
  return UserModel.create({
    name: `User ${counter}`,
    email: `user${counter}@test.local`,
    passwordHash: await hashPassword(TEST_PASSWORD),
    roleId,
    centreId,
  });
};

/** Signs in as a new user with the given role and returns an agent that keeps the session cookie. */
export const signedInAgent = async (roleId: RoleId, centreId: string | null = null) => {
  const user = await createUser(roleId, centreId);
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email: user.email, password: TEST_PASSWORD });
  if (res.status !== 200) throw new Error(`Login failed in test helper: ${res.status}`);
  return { agent, user };
};

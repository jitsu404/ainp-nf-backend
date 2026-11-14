import type { RoleId } from '../config/constants.js';

/** The signed-in user, set by middlewares/authenticate.ts. */
export interface AuthUser {
  id: string;
  roleId: RoleId;
  centreId: string | null;
  name: string;
  mustChangePassword: boolean;
}

declare global {
  namespace Express {
    interface Request {
      /** Correlation id, set by middlewares/requestId.ts and echoed as X-Request-Id. */
      id: string;
      user?: AuthUser;
      /** Parsed DTOs written by middlewares/validate.ts. Read them with getValidated(). */
      validated: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}

import type { RoleId } from '../config/constants.js';

/** The signed-in user, set by middlewares/authenticate.ts. */
export interface AuthUser {
  id: string;
  roleId: RoleId;
  centreId: string | null;
  /**
   * Experiment PI: the experiments their seat leads (their scope everywhere).
   * Centre PI: the experiments their centre has a trial in, withdrawn ones included (their scope
   * for experiments only; other collections are scoped by centre). Empty for national roles.
   */
  experimentIds: string[];
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

import { env } from '../config/env.js';

// The only place in the codebase allowed to use console.* (enforced by ESLint).
// Prints only when NODE_ENV is "development". Pass force = true to print in every environment.
// Anything operational (errors, auth failures, workflow changes) belongs in `logger`, not here.

const shouldPrint = (force: boolean): boolean => force || env.NODE_ENV === 'development';

export function devLog(data: unknown, force = false): void {
  if (shouldPrint(force)) console.log(data);
}

devLog.warn = (data: unknown, force = false): void => {
  if (shouldPrint(force)) console.warn(data);
};

devLog.error = (data: unknown, force = false): void => {
  if (shouldPrint(force)) console.error(data);
};

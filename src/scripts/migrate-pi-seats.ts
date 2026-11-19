// One-off migration (2026-11-19): Centre PI accounts become seats. Before, a Centre PI signed in
// with their own email; now each centre has one permanent login, <centre code>.pi.npnf@icar.org.in,
// and the person's own email moves to `contactEmail`. Passwords are kept, so the PI signs in with
// the new login and the same password. Tell each PI their new login before applying.
//
//   npm run migrate:pi-seats            dry run: prints what would change, writes nothing
//   npm run migrate:pi-seats -- --apply  writes the changes
//
// Safe to re-run: accounts that are already seats are skipped. Past (deactivated) Centre PI
// accounts are left as they are; they still show in the centre's PI history.

import { trusted } from 'mongoose';
import { centrePiEmail } from '../config/constants.js';
import { connectDB, disconnectDB } from '../config/db.js';
import { CentreModel } from '../modules/centres/centres.model.js';
import { UserModel } from '../modules/users/users.model.js';
import { devLog } from '../utils/devLog.js';
import { logger } from '../utils/logger.js';

const apply = process.argv.includes('--apply');

const run = async () => {
  const pis = await UserModel.find({ roleId: 'pi', isActive: true, seatKind: null }).lean();
  const centres = new Map(
    (await CentreModel.find({ _id: trusted({ $in: pis.map((p) => p.centreId) }) }).lean()).map((c) => [
      String(c._id),
      c.code,
    ]),
  );
  devLog(
    `${pis.length} Centre PI account(s) to move to seats${apply ? '' : ' (dry run: nothing will be written)'}`,
    true,
  );

  for (const pi of pis) {
    const code = centres.get(String(pi.centreId));
    if (!code) {
      devLog(`${pi.email}: centre not found, skipped`, true);
      continue;
    }
    const login = centrePiEmail(code);
    const taken = await UserModel.exists({ email: login, _id: trusted({ $ne: pi._id }) });
    if (taken) {
      devLog(`${pi.email}: ${login} is already used by another account, skipped`, true);
      continue;
    }
    devLog(`${pi.name}: sign-in ${pi.email} → ${login} (own email kept as contact)`, true);
    if (apply) {
      await UserModel.updateOne(
        { _id: pi._id },
        {
          email: login,
          contactEmail: pi.email,
          seatKind: 'centre',
          occupiedSince: pi.createdAt,
          mustChangePassword: false,
        },
      );
    }
  }
  if (!apply && pis.length) devLog('Re-run with -- --apply to write these changes.', true);
};

try {
  await connectDB();
  await run();
} catch (err) {
  logger.error('Migration failed', { message: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
} finally {
  await disconnectDB();
}

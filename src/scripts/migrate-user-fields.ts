// One-off migration (2026-11-14): accounts created before the PCU master-table fields existed have a
// single `name` and an optional `phone`. This fills title / firstName / middleName / surname from the
// name, moves phone → mobile, and sets organization (the centre's host institution for a Centre PI,
// ICAR-IIFSR otherwise).
//
//   npm run migrate:user-fields            dry run: prints what would change, writes nothing
//   npm run migrate:user-fields -- --apply  writes the changes
//
// Safe to re-run: accounts that already have a first name are skipped. Review the dry run first:
// names are split by a simple rule, so check odd ones and fix them afterwards in the app.

import { trusted } from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';
import { CentreModel } from '../modules/centres/centres.model.js';
import { UserModel } from '../modules/users/users.model.js';
import { composeName, splitName } from '../modules/users/users.names.js';
import { devLog } from '../utils/devLog.js';
import { logger } from '../utils/logger.js';

const PCU_ORGANIZATION = 'ICAR-Indian Institute of Farming Systems Research, Modipuram';
const apply = process.argv.includes('--apply');

const run = async () => {
  // Accounts still on the old shape. `phone` is no longer in the schema, so read it raw.
  const users = await UserModel.find({ firstName: trusted({ $exists: false }) }).lean();
  const raw = await UserModel.collection
    .find({ _id: { $in: users.map((u) => u._id) } }, { projection: { phone: 1 } })
    .toArray();
  const phoneOf = new Map(raw.map((r) => [String(r._id), r.phone as string | undefined]));
  const centres = new Map(
    (
      await CentreModel.find({ _id: trusted({ $in: users.map((u) => u.centreId).filter(Boolean) }) }).lean()
    ).map((c) => [String(c._id), c.host]),
  );

  devLog(`${users.length} account(s) to migrate${apply ? '' : ' (dry run: nothing will be written)'}`, true);

  for (const user of users) {
    const parts = splitName(user.name);
    const phone = phoneOf.get(String(user._id));
    const set = {
      ...parts,
      name: composeName(parts),
      mobile: user.mobile ?? phone ?? null,
      organization:
        user.organization ??
        (user.centreId ? (centres.get(String(user.centreId)) ?? PCU_ORGANIZATION) : PCU_ORGANIZATION),
    };
    devLog(
      `${user.email}: "${user.name}" → title=${set.title ?? '—'} first=${set.firstName} middle=${set.middleName ?? '—'} surname=${set.surname ?? '—'} | mobile=${set.mobile ?? '—'} | org=${set.organization}`,
      true,
    );
    if (apply) {
      await UserModel.collection.updateOne({ _id: user._id }, { $set: set, $unset: { phone: '' } });
    }
  }

  if (!apply && users.length) devLog('Re-run with -- --apply to write these changes.', true);
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

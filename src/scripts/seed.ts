// Seeds the first Super Administrator account and the SAMPLE centre list.
// Run with: npm run seed   (safe to re-run; existing records are left alone)
// The centres are placeholders until the Project Coordination Unit supplies the real list.

import { connectDB, disconnectDB } from '../config/db.js';
import { env } from '../config/env.js';
import { CentreModel } from '../modules/centres/centres.model.js';
import { UserModel } from '../modules/users/users.model.js';
import { passwordSchema } from '../modules/users/users.dto.js';
import { hashPassword } from '../modules/users/users.service.js';
import { devLog } from '../utils/devLog.js';
import { logger } from '../utils/logger.js';

const SAMPLE_CENTRES = [
  ['MDP', 'Modipuram', 'ICAR-Indian Institute of Farming Systems Research', 'Uttar Pradesh'],
  ['PNT', 'Pantnagar', 'GB Pant University of Agriculture & Technology', 'Uttarakhand'],
  ['LDH', 'Ludhiana', 'Punjab Agricultural University', 'Punjab'],
  ['PLP', 'Palampur', 'CSK Himachal Pradesh Krishi Vishvavidyalaya', 'Himachal Pradesh'],
  ['UDP', 'Udaipur', 'Maharana Pratap University of Agriculture & Technology', 'Rajasthan'],
  ['JND', 'Junagadh', 'Junagadh Agricultural University', 'Gujarat'],
  ['JBP', 'Jabalpur', 'Jawaharlal Nehru Krishi Vishwa Vidyalaya', 'Madhya Pradesh'],
  ['RPR', 'Raipur', 'Indira Gandhi Krishi Vishwavidyalaya', 'Chhattisgarh'],
  ['RNC', 'Ranchi', 'Birsa Agricultural University', 'Jharkhand'],
  ['DWD', 'Dharwad', 'University of Agricultural Sciences', 'Karnataka'],
  ['CBE', 'Coimbatore', 'Tamil Nadu Agricultural University', 'Tamil Nadu'],
  ['GTR', 'Guntur', 'Acharya NG Ranga Agricultural University', 'Andhra Pradesh', 'Voluntary Centre'],
  ['TSR', 'Thrissur', 'Kerala Agricultural University', 'Kerala', 'Voluntary Centre'],
  ['UMM', 'Umiam', 'ICAR Research Complex for NEH Region', 'Meghalaya'],
] as const;

// The Super Administrator is the bootstrap account: it creates the PCU accounts
// (Project Coordinator, Administrator), who then create centres and assign PIs.
const seedSuperAdmin = async (): Promise<void> => {
  const { SEED_SUPERADMIN_EMAIL: email, SEED_SUPERADMIN_PASSWORD: password } = env;
  if (!email || !password) {
    devLog.warn(
      'Skipping Super Administrator: set SEED_SUPERADMIN_EMAIL and SEED_SUPERADMIN_PASSWORD in .env',
      true,
    );
    return;
  }
  passwordSchema.parse(password);
  if (await UserModel.exists({ email })) {
    devLog(`Super Administrator ${email} already exists`, true);
    return;
  }
  await UserModel.create({
    name: 'Super Administrator',
    email,
    passwordHash: await hashPassword(password),
    roleId: 'superadmin',
    designation: 'Super Administrator',
  });
  devLog(`Created Super Administrator ${email}`, true);
};

const seedCentres = async (): Promise<void> => {
  const result = await CentreModel.bulkWrite(
    SAMPLE_CENTRES.map(([code, name, host, state, type = 'Network Centre']) => ({
      updateOne: {
        filter: { code },
        update: { $setOnInsert: { code, name, host, state, type, isActive: true } },
        upsert: true,
      },
    })),
  );
  devLog(
    `Centres: ${result.upsertedCount} added, ${SAMPLE_CENTRES.length - result.upsertedCount} already present`,
    true,
  );
};

try {
  await connectDB();
  await seedSuperAdmin();
  await seedCentres();
} catch (err) {
  logger.error('Seed failed', { message: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
} finally {
  await disconnectDB();
}

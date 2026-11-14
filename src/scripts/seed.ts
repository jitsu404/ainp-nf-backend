// Seeds the first Super Admin account and the AINP-NF centre list.
// Run with: npm run seed   (safe to re-run; existing records are left alone)
//
// Centres come from the PCU's master table "2_AICRPMaster Tables_AICRP-NF.xlsx" (Locations sheet).
// Centre codes are ours (the sheet has none). Known issues in the source, kept as given until the
// PCU confirms: Gangtok repeats Umiam's address and pincode; Bhopal's pincode is Calicut's (673012).

import { connectDB, disconnectDB } from '../config/db.js';
import { env } from '../config/env.js';
import { CentreModel } from '../modules/centres/centres.model.js';
import { passwordSchema } from '../modules/users/users.dto.js';
import { UserModel } from '../modules/users/users.model.js';
import { hashPassword } from '../modules/users/users.service.js';
import { devLog } from '../utils/devLog.js';
import { logger } from '../utils/logger.js';

// [code, location, host short, host type, host institution, city, pincode, state, agro-climatic zone]
type CentreRow = readonly [string, string, string, string, string, string, string, string, string];

export const NF_CENTRES: readonly CentreRow[] = [
  [
    'BJR',
    'Bajaura',
    'HPKVV',
    'SAU',
    'CSK Himachal Pradesh Krishi Vishwavidyalaya, Palampur',
    'Palampur',
    '176062',
    'Himachal Pradesh',
    'Western Himalaya',
  ],
  [
    'PNT',
    'Pantnagar',
    'GBPUA&T',
    'SAU',
    'Govind Ballabh Pant Univ. of Agri. & Technology, Pantnagar',
    'Pantnagar',
    '263145',
    'Uttarakhand',
    'Upper Gangetic Plains',
  ],
  [
    'RNC',
    'Ranchi',
    'BAU',
    'SAU',
    'Birsa Agricultural University, Kanke, Ranchi',
    'Ranchi',
    '834006',
    'Jharkhand',
    'Eastern Plateau and Hills',
  ],
  [
    'LDH',
    'Ludhiana',
    'PAU',
    'SAU',
    'Punjab Agricultural University, Ludhiana',
    'Ludhiana',
    '141004',
    'Punjab',
    'Trans Gangetic Plains',
  ],
  [
    'SKN',
    'SK Nagar',
    'SDAU',
    'SAU',
    'Sardarkrushinagar-Dantiwada Agricultural University, Sardarkrushinagar, Dist. Banaskantha',
    'SK Nagar',
    '385506',
    'Gujarat',
    'Gujarat Plains and Hills',
  ],
  [
    'JBP',
    'Jabalpur',
    'JNKVV',
    'SAU',
    'Jawaharlal Nehru Krishi Viswa Vidyalya, Jabalpur',
    'Jabalpur',
    '482004',
    'Madhya Pradesh',
    'Central Plateau and Hills',
  ],
  [
    'RPR',
    'Raipur',
    'IGKV',
    'SAU',
    'Indira Gandhi Krishi Vishwavidyalaya, Raipur',
    'Raipur',
    '492001',
    'Chhattisgarh',
    'Eastern Plateau and Hills',
  ],
  [
    'KJT',
    'Karjat',
    'KKV',
    'SAU',
    'Dr Balasaheb Sawant Konkan Krishi Vidyapeeth, Dapoli',
    'Dapoli',
    '410201',
    'Maharashtra',
    'West Coast Plains and Ghat',
  ],
  [
    'CBE',
    'Coimbatore',
    'TNAU',
    'SAU',
    'Tamil Nadu Agricultural University, Coimbatore',
    'Coimbatore',
    '641003',
    'Tamil Nadu',
    'Southern Plateau and Hills',
  ],
  [
    'UDP',
    'Udaipur',
    'MPUAT',
    'SAU',
    'Maharana Pratap Univ. of Agriculture & Tech., Udaipur',
    'Udaipur',
    '313001',
    'Rajasthan',
    'Central Plateau and Hills',
  ],
  [
    'DWD',
    'Dharwad',
    'UAS',
    'SAU',
    'University of Agricultural Sciences, Dharwad',
    'Dharwad',
    '580005',
    'Karnataka',
    'Southern Plateau and Hills',
  ],
  [
    'MDP',
    'Modipuram',
    'ICAR-IIFSR',
    'ICAR',
    'ICAR-Indian Institute of Farming Systems Research, Modipuram',
    'Modipuram',
    '250110',
    'Uttar Pradesh',
    'Upper Gangetic Plains',
  ],
  [
    'UMM',
    'Umiam',
    'ICAR-RC-NEH',
    'ICAR',
    'ICAR Research Complex for North Eastern Region, Umiam',
    'Umiam',
    '793103',
    'Meghalaya',
    'Eastern Himalaya',
  ],
  [
    'GTK',
    'Gangtok',
    'ICAR-RC-NEH',
    'ICAR',
    'ICAR Research Complex for North Eastern Region, Umiam',
    'Umiam',
    '793103',
    'Meghalaya',
    'Eastern Himalaya',
  ],
  [
    'ALM',
    'Almora',
    'ICAR-VPKAS',
    'ICAR',
    'ICAR-Vivekananda Parvatiya Krishi Anusandhan Sansthan, Almora',
    'Almora',
    '263601',
    'Uttarakhand',
    'Western Himalaya',
  ],
  [
    'AJM',
    'Ajmer',
    'ICAR-NRCSS',
    'ICAR',
    'ICAR-National Research Centre on Seed Spices, Tabiji, Ajmer',
    'Ajmer',
    '305206',
    'Rajasthan',
    'Central Plateau and Hills',
  ],
  [
    'TVM',
    'Thiruvananthapuram',
    'ICAR-CTCRI',
    'ICAR',
    'ICAR-Central Tuber Crops Research Institute, Sreekariyam, Thiruvananthapuram',
    'Thiruvananthapuram',
    '695017',
    'Kerala',
    'West Coast Plains and Ghat',
  ],
  [
    'CLT',
    'Calicut',
    'ICAR-IISR',
    'ICAR',
    'ICAR-Indian Institute of Spices Research, Marikunnu PO, Calicut',
    'Calicut',
    '673012',
    'Kerala',
    'West Coast Plains and Ghat',
  ],
  [
    'BPL',
    'Bhopal',
    'ICAR-IISS',
    'ICAR',
    'ICAR-Indian Institute of Soil Science, Nabibagh, Berasia Road, Bhopal',
    'Bhopal',
    '673012',
    'Madhya Pradesh',
    'Central Plateau and Hills',
  ],
  [
    'NDP',
    'Narendrapur',
    'RKMVERI',
    'Deemed University',
    'Ramakrishna Mission Vivekananda University, PO Belur Math, Distt. Howrah',
    'Howrah',
    '711202',
    'West Bengal',
    'Lower Gangetic Plains',
  ],
];

// The bootstrap account. It creates the PCU accounts; PCU and Super Admin then manage centres and PIs.
const seedSuperAdmin = async (): Promise<void> => {
  const { SEED_SUPERADMIN_EMAIL: email, SEED_SUPERADMIN_PASSWORD: password } = env;
  if (!email || !password) {
    devLog.warn('Skipping Super Admin: set SEED_SUPERADMIN_EMAIL and SEED_SUPERADMIN_PASSWORD in .env', true);
    return;
  }
  passwordSchema.parse(password);
  if (await UserModel.exists({ email })) {
    devLog(`Super Admin ${email} already exists`, true);
    return;
  }
  await UserModel.create({
    name: 'Super Admin',
    email,
    passwordHash: await hashPassword(password),
    roleId: 'superadmin',
    designation: 'Super Admin',
    // Chosen by whoever runs the seed, so no forced change. Rotate it after go-live.
    mustChangePassword: false,
  });
  devLog(`Created Super Admin ${email}`, true);
};

const seedCentres = async (): Promise<void> => {
  const result = await CentreModel.bulkWrite(
    NF_CENTRES.map(([code, name, hostShort, hostType, host, city, pincode, state, zone]) => ({
      updateOne: {
        filter: { code },
        update: {
          $setOnInsert: {
            code,
            name,
            hostShort,
            hostType,
            host,
            city,
            pincode,
            state,
            zone,
            type: 'Network Centre',
            isActive: true,
          },
        },
        upsert: true,
      },
    })),
  );
  devLog(
    `Centres: ${result.upsertedCount} added, ${NF_CENTRES.length - result.upsertedCount} already present`,
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

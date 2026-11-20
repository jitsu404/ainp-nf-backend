// One-off migration (2026-11-19): trials become the record of an experiment's assignment to a
// centre. Before, only `experiment.centreIds` said which centres were assigned, and a centre that
// was unassigned kept a trial with no state. Now each trial has `assignmentStatus`:
//   centre in experiment.centreIds  → Active
//   centre not in it (unassigned)    → Withdrawn (its data stays, read-only)
// and centres listed without a trial get one, so the cache and the trials agree.
//
// It also carries over per-centre crops saved by the short-lived `experimentassignments`
// collection (season → crop ids per experiment × centre) into the trial's `seasonCrops`, for
// seasons where they differ from the experiment's crops. Drop that collection after applying.
//
//   npm run migrate:trial-assignments            dry run: prints what would change, writes nothing
//   npm run migrate:trial-assignments -- --apply  writes the changes
//
// Safe to re-run: trials that already have the right status are skipped.

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/db.js';
import { ExperimentModel } from '../modules/experiments/experiments.model.js';
import { TrialModel } from '../modules/trials/trials.model.js';
import { devLog } from '../utils/devLog.js';
import { logger } from '../utils/logger.js';

const apply = process.argv.includes('--apply');

type SeasonIds = Record<string, unknown[]>;
const sameIds = (a: unknown[] = [], b: unknown[] = []) =>
  JSON.stringify(a.map(String).sort()) === JSON.stringify(b.map(String).sort());

/** Per-centre crops from experimentassignments → trial.seasonCrops (where they differ). */
const carryOverAssignmentCrops = async (experiments: { _id: unknown; code: string; seasons?: unknown }[]) => {
  const db = mongoose.connection.db;
  if (!db) return 0;
  const exists = await db.listCollections({ name: 'experimentassignments' }).hasNext();
  if (!exists) return 0;
  const byId = new Map(experiments.map((e) => [String(e._id), e]));
  const assignments = await db
    .collection('experimentassignments')
    .find({ status: { $ne: 'inactive' } })
    .toArray();
  let changed = 0;
  for (const a of assignments) {
    const experiment = byId.get(String(a.experiment));
    if (!experiment) continue;
    const defaults = (experiment.seasons ?? {}) as SeasonIds;
    const own = Object.fromEntries(
      Object.entries((a.seasons ?? {}) as SeasonIds).filter(([code, ids]) => !sameIds(ids, defaults[code])),
    );
    if (!Object.keys(own).length) continue;
    changed += 1;
    devLog(
      `${experiment.code}: centre ${String(a.centre)} grows its own crops in ${Object.keys(own).join(', ')}`,
      true,
    );
    if (apply) {
      const set = Object.fromEntries(Object.entries(own).map(([code, ids]) => [`seasonCrops.${code}`, ids]));
      await TrialModel.updateOne({ experimentId: a.experiment, centreId: a.centre }, { $set: set });
    }
  }
  return changed;
};

const run = async () => {
  const experiments = await ExperimentModel.find(
    {},
    { code: 1, centreIds: 1, createdBy: 1, seasons: 1 },
  ).lean();
  devLog(
    `${experiments.length} experiment(s) to check${apply ? '' : ' (dry run: nothing will be written)'}`,
    true,
  );
  let changed = 0;
  for (const experiment of experiments) {
    const assigned = new Set((experiment.centreIds ?? []).map(String));
    // Raw documents: older trials have no assignmentStatus at all.
    const trials = await TrialModel.find(
      { experimentId: experiment._id },
      { centreId: 1, assignmentStatus: 1 },
    )
      .lean()
      .exec();
    const withTrial = new Set(trials.map((t) => String(t.centreId)));

    for (const trial of trials) {
      const status = assigned.has(String(trial.centreId)) ? 'Active' : 'Withdrawn';
      const raw = (trial as { assignmentStatus?: string }).assignmentStatus;
      if (raw === status) continue;
      changed += 1;
      devLog(`${experiment.code}: trial at centre ${String(trial.centreId)} → ${status}`, true);
      if (apply) {
        await TrialModel.updateOne(
          { _id: trial._id },
          status === 'Active'
            ? { assignmentStatus: 'Active' }
            : {
                assignmentStatus: 'Withdrawn',
                withdrawReason: 'Unassigned before assignment history was kept',
              },
        );
      }
    }
    for (const centreId of assigned) {
      if (withTrial.has(centreId)) continue;
      changed += 1;
      devLog(`${experiment.code}: centre ${centreId} is assigned but has no trial → create one`, true);
      if (apply) {
        await TrialModel.create({
          experimentId: experiment._id,
          centreId,
          assignmentStatus: 'Active',
          createdBy: experiment.createdBy,
          updatedBy: experiment.createdBy,
        });
      }
    }
  }
  changed += await carryOverAssignmentCrops(experiments);
  devLog(
    `${changed} change(s)${apply ? ' written' : ' would be written; add -- --apply to write them'}`,
    true,
  );
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

// One-off migration (2026-11-21): crops, units and parameters get generated codes.
// Before, people typed codes (RICE, KG_HA, GRAIN_YIELD); now the system gives them CRP-001 …,
// UNT-001 … and PRM_001 … (counters `crop`, `unit`, `parameter`). This renames the existing items
// and every record that refers to them by code, in one transaction:
//   crops       → trials' cropping systems (main crop, intercrop) and sheets' crop
//   units       → parameters' unit
//   parameters  → formulas of calculated parameters
// Records that refer by id (experiment seasons, trial crops per season, protocol parameters,
// observations) need nothing. The audit trail keeps the old codes: it records what was true then.
//
//   npm run migrate:generated-codes             dry run: prints the old → new codes, writes nothing
//   npm run migrate:generated-codes -- --apply  writes the changes
//
// Safe to re-run: items that already have a code of their series are kept, and new codes continue
// after the highest one in use (and after the counter), so nothing is renumbered twice.

import { trusted } from 'mongoose';
import { connectDB, disconnectDB, withTransaction } from '../config/db.js';
import {
  type CodeSeries,
  CODE_SERIES,
  codeNumber,
  raiseCounter,
} from '../modules/counters/counters.service.js';
import { CounterModel } from '../modules/counters/counters.model.js';
import { MasterItemModel } from '../modules/masters/masters.model.js';
import { ParameterModel } from '../modules/parameters/parameters.model.js';
import { SheetModel } from '../modules/sheets/sheets.model.js';
import { TrialModel } from '../modules/trials/trials.model.js';
import { devLog } from '../utils/devLog.js';
import { renameFormulaCodes } from '../utils/formula.js';
import { logger } from '../utils/logger.js';

const apply = process.argv.includes('--apply');

interface Item {
  id: unknown;
  code: string;
  name: string;
}

/**
 * Old code → new code for the items not yet in the series, numbered in list order after the highest
 * number already used (by an item or the counter). Also returns that highest number.
 */
const plan = async (series: CodeSeries, items: Item[]) => {
  const counter = (await CounterModel.findOne({ key: series.key }).lean())?.lastCount ?? 0;
  let last = Math.max(counter, ...items.map((i) => codeNumber(series, i.code) ?? 0));
  const renames = new Map<string, { id: unknown; code: string; name: string }>();
  for (const item of items) {
    if (codeNumber(series, item.code) !== null) continue;
    last += 1;
    renames.set(item.code, { id: item.id, code: series.format(last), name: item.name });
  }
  return { renames, last };
};

const show = (label: string, renames: Map<string, { code: string; name: string }>) => {
  devLog(`${label}: ${renames.size} to rename`, true);
  for (const [from, { code, name }] of renames) devLog(`  ${from.padEnd(22)} → ${code}  ${name}`, true);
};

const run = async () => {
  // List order: as the screens show them (crops and units by sort order then name; parameters by
  // category then name), so the numbers read naturally.
  const crops = await MasterItemModel.find({ type: 'crop' }, { code: 1, name: 1 })
    .sort({ sortOrder: 1, name: 1 })
    .lean();
  const units = await MasterItemModel.find({ type: 'unit' }, { code: 1, name: 1 })
    .sort({ sortOrder: 1, name: 1 })
    .lean();
  const params = await ParameterModel.find({}, { code: 1, name: 1, unitCode: 1, formula: 1 })
    .sort({ category: 1, name: 1 })
    .lean();

  const toItem = (d: { _id: unknown; code: string; name: string }): Item => ({
    id: d._id,
    code: d.code,
    name: d.name,
  });
  const crop = await plan(CODE_SERIES.crop, crops.map(toItem));
  const unit = await plan(CODE_SERIES.unit, units.map(toItem));
  const param = await plan(CODE_SERIES.parameter, params.map(toItem));
  show('Crops', crop.renames);
  show('Units', unit.renames);
  show('Parameters', param.renames);

  const newCrop = (c: string | null | undefined) => (c ? (crop.renames.get(c)?.code ?? c) : c);
  const newParam = (c: string) => param.renames.get(c)?.code;

  // References that change.
  const trials = await TrialModel.find({}, { croppingSystems: 1 }).lean();
  const trialUpdates = trials
    .map((t) => {
      let changed = false;
      const croppingSystems = t.croppingSystems.map((cs) => ({
        ...cs,
        crops: cs.crops.map((c) => {
          const code = newCrop(c.cropCode)!;
          if (code !== c.cropCode) changed = true;
          return { ...c, cropCode: code };
        }),
      }));
      return changed ? { id: t._id, croppingSystems } : null;
    })
    .filter((u) => u !== null);
  const sheetCount = crop.renames.size
    ? await SheetModel.countDocuments({ cropCode: trusted({ $in: [...crop.renames.keys()] }) })
    : 0;
  const unitParams = params.filter((p) => p.unitCode && unit.renames.has(p.unitCode));
  const formulaUpdates = params
    .filter((p) => p.formula)
    .map((p) => ({ id: p._id, code: p.code, from: p.formula!, to: renameFormulaCodes(p.formula!, newParam) }))
    .filter((f) => f.to !== f.from);

  devLog(`Trials with crops in cropping systems to update: ${trialUpdates.length}`, true);
  devLog(`Sheets with a crop to update: ${sheetCount}`, true);
  devLog(`Parameters whose unit changes: ${unitParams.length}`, true);
  devLog(`Formulas to rewrite: ${formulaUpdates.length}`, true);
  for (const f of formulaUpdates) devLog(`  ${f.code}: ${f.from}  →  ${f.to}`, true);

  if (!apply) {
    devLog('Dry run: nothing was written. Re-run with -- --apply to write these changes.', true);
    return;
  }

  await withTransaction(async (session) => {
    for (const { id, code } of crop.renames.values()) {
      await MasterItemModel.updateOne({ _id: id }, { $set: { code } }, { session });
    }
    for (const { id, code } of unit.renames.values()) {
      await MasterItemModel.updateOne({ _id: id }, { $set: { code } }, { session });
    }
    for (const u of trialUpdates) {
      await TrialModel.updateOne(
        { _id: u.id },
        { $set: { croppingSystems: u.croppingSystems } },
        { session },
      );
    }
    for (const [from, { code }] of crop.renames) {
      await SheetModel.updateMany({ cropCode: from }, { $set: { cropCode: code } }, { session });
    }
    for (const [from, { code }] of unit.renames) {
      await ParameterModel.updateMany({ unitCode: from }, { $set: { unitCode: code } }, { session });
    }
    for (const { id, code } of param.renames.values()) {
      await ParameterModel.updateOne({ _id: id }, { $set: { code } }, { session });
    }
    for (const f of formulaUpdates) {
      await ParameterModel.updateOne({ _id: f.id }, { $set: { formula: f.to } }, { session });
    }
    // The counters continue after the highest code now in use.
    await raiseCounter(CODE_SERIES.crop.key, crop.last, session);
    await raiseCounter(CODE_SERIES.unit.key, unit.last, session);
    await raiseCounter(CODE_SERIES.parameter.key, param.last, session);
  });
  logger.info('Generated-code migration applied', {
    crops: crop.renames.size,
    units: unit.renames.size,
    parameters: param.renames.size,
    trials: trialUpdates.length,
    sheets: sheetCount,
    formulas: formulaUpdates.length,
  });
  devLog('Applied.', true);
};

try {
  await connectDB();
  await run();
} catch (err) {
  logger.error('Migration failed', { message: err instanceof Error ? err.message : String(err) });
  devLog.error(err, true);
  process.exitCode = 1;
} finally {
  await disconnectDB();
}

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { FinancialYearModel, fyDates } from '../src/modules/financialYears/financialYears.model.js';
import { MasterItemModel } from '../src/modules/masters/masters.model.js';
import { ParameterModel } from '../src/modules/parameters/parameters.model.js';
import { analyseParameter, dmrtLetters, pooledAnalysis } from '../src/modules/sheets/sheets.analysis.js';
import { createCentre, signedInAgent } from './helpers.js';

const FY = '2026-27';

/** Masters, a year, two parameters and two centres, plus signed-in PCU and Centre PI agents. */
const setup = async () => {
  await MasterItemModel.insertMany([
    { type: 'season', code: 'KHARIF', name: 'Kharif' },
    { type: 'season', code: 'RABI', name: 'Rabi' },
    { type: 'programme', code: 'P2', name: 'Package of practices' },
    { type: 'crop', code: 'RICE', name: 'Rice', group: 'Cereal' },
    { type: 'crop', code: 'WHEAT', name: 'Wheat', group: 'Cereal' },
    { type: 'unit', code: 'KG_HA', name: 'kg/ha' },
    { type: 'unit', code: 'RS_HA', name: 'Rs/ha' },
  ]);
  await FinancialYearModel.create({ code: FY, ...fyDates(FY), isOpen: true, isCurrent: true });
  const grain = await ParameterModel.create({
    code: 'GRAIN_YIELD',
    name: 'Grain yield',
    unitCode: 'KG_HA',
    category: 'Yield',
    min: 0,
    max: 20000,
  });
  const net = await ParameterModel.create({
    code: 'NET_RETURNS',
    name: 'Net returns',
    unitCode: 'RS_HA',
    category: 'Economics',
    min: null,
    max: null,
  });
  const centreA = await createCentre();
  const centreB = await createCentre();
  const { agent: pcu } = await signedInAgent('pc');
  const { agent: piA } = await signedInAgent('pi', centreA.id);
  const { agent: piB } = await signedInAgent('pi', centreB.id);

  const experiment = await pcu
    .post('/api/v1/experiments')
    .send({
      code: 'NF-LTE',
      title: 'Long-term evaluation of natural farming practices',
      programmeCode: 'P2',
      design: 'RBD',
      replications: 3,
      treatments: [
        { code: 'T1', name: 'Control' },
        { code: 'T2', name: 'Complete NF' },
        { code: 'T3', name: 'ICM' },
      ],
      parameters: [
        { parameterId: grain.id, section: 'Yield', level: 'plot', required: true },
        { parameterId: net.id, section: 'Economics', level: 'treatment' },
      ],
      seasons: ['KHARIF'],
      startYear: FY,
      centreIds: [centreA.id, centreB.id],
    })
    .expect(201);
  await pcu.patch(`/api/v1/experiments/${experiment.body.data.id}`).send({ status: 'Active' }).expect(200);
  const trials = await pcu.get(`/api/v1/trials?experimentId=${experiment.body.data.id}`).expect(200);
  const trialA = trials.body.data.find((t: { centreId: { id: string } }) => t.centreId.id === centreA.id);
  return {
    pcu,
    piA,
    piB,
    grain,
    net,
    centreA,
    centreB,
    experimentId: experiment.body.data.id as string,
    trialAId: trialA.id as string,
  };
};

const fullPlotData = (grainId: string, yields: Record<string, number[]>) =>
  Object.entries(yields).flatMap(([t, ys]) =>
    ys.map((value, i) => ({ treatmentCode: t, replication: i + 1, parameterId: grainId, value })),
  );

describe('experiments and trials', () => {
  it('PCU creates and assigns an experiment; each centre gets a trial and sees only its own', async () => {
    const { pcu, piA, piB, experimentId, trialAId } = await setup();
    const all = await pcu.get('/api/v1/trials').expect(200);
    expect(all.body.data).toHaveLength(2);

    const mine = await piA.get('/api/v1/trials').expect(200);
    expect(mine.body.data.map((t: { id: string }) => t.id)).toEqual([trialAId]);
    await piB.get(`/api/v1/trials/${trialAId}`).expect(404);
    await piA.get(`/api/v1/experiments/${experimentId}`).expect(200);

    await piA.post('/api/v1/experiments').send({}).expect(403);
  });

  it('validates the protocol (programme, replications, unique treatments)', async () => {
    const { pcu, grain } = await setup();
    const base = { code: 'X1', title: 'Some experiment', design: 'RBD', startYear: FY };
    const noReps = await pcu
      .post('/api/v1/experiments')
      .send({ ...base, programmeCode: 'P2', replications: 1 })
      .expect(400);
    expect(noReps.body.error.code).toBe('VALIDATION_ERROR');
    const badProgramme = await pcu
      .post('/api/v1/experiments')
      .send({ ...base, programmeCode: 'P9', replications: 3 })
      .expect(400);
    expect(badProgramme.body.error.code).toBe('UNKNOWN_PROGRAMME');
    await pcu
      .post('/api/v1/experiments')
      .send({
        ...base,
        programmeCode: 'P2',
        replications: 3,
        treatments: [
          { code: 'T1', name: 'A' },
          { code: 't1', name: 'B' },
        ],
        parameters: [{ parameterId: grain.id }],
      })
      .expect(400);
  });

  it('lets the centre set up cropping systems and practices, checked against masters and protocol', async () => {
    const { piA, trialAId } = await setup();
    const ok = await piA
      .patch(`/api/v1/trials/${trialAId}`)
      .send({
        croppingSystems: [
          {
            code: 'cs1',
            name: 'Rice – Wheat',
            seasons: [
              {
                seasonCode: 'KHARIF',
                mainCropCode: 'RICE',
                mainVariety: 'Pusa Basmati 1121',
                rowRatio: '2:1',
              },
            ],
          },
        ],
        practices: [{ treatmentCode: 'T2', nutrientDetails: 'Jeevamrit 500 l/ha at 15-day interval' }],
        status: 'Running',
      })
      .expect(200);
    expect(ok.body.data.croppingSystems[0]).toMatchObject({
      code: 'CS1',
      seasons: [{ mainCropCode: 'RICE' }],
    });
    expect(ok.body.data.experiment.treatments).toHaveLength(3);

    const badCrop = await piA
      .patch(`/api/v1/trials/${trialAId}`)
      .send({
        croppingSystems: [
          { code: 'CS1', name: 'Test system', seasons: [{ seasonCode: 'KHARIF', mainCropCode: 'MANGO' }] },
        ],
      })
      .expect(400);
    expect(badCrop.body.error.code).toBe('UNKNOWN_CROP');
    const badSeason = await piA
      .patch(`/api/v1/trials/${trialAId}`)
      .send({
        croppingSystems: [
          { code: 'CS1', name: 'Test system', seasons: [{ seasonCode: 'RABI', mainCropCode: 'WHEAT' }] },
        ],
      })
      .expect(400);
    expect(badSeason.body.error.code).toBe('SEASON_NOT_IN_PROTOCOL');
  });
});

describe('observation sheets', () => {
  it('records data with validation, then submit → return → resubmit → approve, and locks', async () => {
    const { pcu, piA, grain, net, experimentId, trialAId } = await setup();
    const sheet = await piA
      .post('/api/v1/sheets')
      .send({ trialId: trialAId, fyCode: FY, seasonCode: 'KHARIF' })
      .expect(201);
    const id = sheet.body.data.id as string;
    await piA
      .post('/api/v1/sheets')
      .send({ trialId: trialAId, fyCode: FY, seasonCode: 'KHARIF' })
      .expect(409);

    const invalid = await piA
      .put(`/api/v1/sheets/${id}/values`)
      .send({
        values: [
          { treatmentCode: 'T1', replication: 1, parameterId: grain.id, value: 99999 }, // above max
          { treatmentCode: 'T9', replication: 1, parameterId: grain.id, value: 10 }, // unknown treatment
          { treatmentCode: 'T1', replication: null, parameterId: grain.id, value: 10 }, // plot-level needs a rep
          { treatmentCode: 'T1', replication: 1, parameterId: net.id, value: 5 }, // treatment-level has no rep
        ],
      })
      .expect(400);
    expect(invalid.body.error.code).toBe('INVALID_VALUES');
    expect(invalid.body.error.details.cells).toHaveLength(4);

    await piA
      .put(`/api/v1/sheets/${id}/values`)
      .send({ values: fullPlotData(grain.id, { T1: [3200, 3400], T2: [3600, 3800, 3700] }) })
      .expect(200);
    const incomplete = await piA.post(`/api/v1/sheets/${id}/submit`).send({}).expect(400);
    expect(incomplete.body.error).toMatchObject({
      code: 'INCOMPLETE_SHEET',
      details: { missing: expect.arrayContaining(['T1 R3: Grain yield', 'T3 R1: Grain yield']) },
    });

    await piA
      .put(`/api/v1/sheets/${id}/values`)
      .send({
        values: [
          ...fullPlotData(grain.id, { T1: [3200, 3400, 3300], T3: [3500, 3550, 3450] }),
          { treatmentCode: 'T2', replication: null, parameterId: net.id, value: 45000 },
        ],
      })
      .expect(200);
    await piA.post(`/api/v1/sheets/${id}/submit`).send({ remark: 'Kharif data' }).expect(200);
    const locked = await piA
      .put(`/api/v1/sheets/${id}/values`)
      .send({ values: fullPlotData(grain.id, { T1: [1] }) })
      .expect(409);
    expect(locked.body.error.code).toBe('SHEET_LOCKED');

    await piA.post(`/api/v1/sheets/${id}/approve`).send({}).expect(403); // a PI can't approve
    await pcu.post(`/api/v1/sheets/${id}/return`).send({ remark: 'Recheck T1 R2' }).expect(200);
    await piA
      .put(`/api/v1/sheets/${id}/values`)
      .send({ values: fullPlotData(grain.id, { T1: [3200, 3350] }) })
      .expect(200);
    await piA.post(`/api/v1/sheets/${id}/submit`).send({}).expect(200);
    const approved = await pcu.post(`/api/v1/sheets/${id}/approve`).send({ remark: 'OK' }).expect(200);
    expect(approved.body.data.status).toBe('Approved');
    expect(approved.body.data.history.map((h: { status: string }) => h.status)).toEqual([
      'Draft',
      'Submitted',
      'Returned',
      'Submitted',
      'Approved',
    ]);
    await pcu.post(`/api/v1/sheets/${id}/approve`).send({}).expect(409);

    // Data now protects the protocol.
    const change = await pcu
      .patch(`/api/v1/experiments/${experimentId}`)
      .send({
        treatments: [
          { code: 'T1', name: 'Control' },
          { code: 'T2', name: 'Complete NF' },
        ],
      })
      .expect(409);
    expect(change.body.error.code).toBe('EXPERIMENT_HAS_DATA');
    await pcu
      .patch(`/api/v1/experiments/${experimentId}`)
      .send({
        treatments: [
          { code: 'T1', name: 'Control' },
          { code: 'T2', name: 'Complete NF' },
          { code: 'T3', name: 'ICM' },
          { code: 'T4', name: 'New' },
        ],
      })
      .expect(200);
  });

  it('keeps centres out of other centres’ sheets and blocks entry in closed years', async () => {
    const { piA, piB, grain, trialAId } = await setup();
    const sheet = await piA
      .post('/api/v1/sheets')
      .send({ trialId: trialAId, fyCode: FY, seasonCode: 'KHARIF' })
      .expect(201);
    await piB.get(`/api/v1/sheets/${sheet.body.data.id}`).expect(404);
    await piB
      .post('/api/v1/sheets')
      .send({ trialId: trialAId, fyCode: FY, seasonCode: 'KHARIF' })
      .expect(404);

    await FinancialYearModel.updateOne({ code: FY }, { isOpen: false });
    const closed = await piA
      .put(`/api/v1/sheets/${sheet.body.data.id}/values`)
      .send({ values: fullPlotData(grain.id, { T1: [1] }) })
      .expect(409);
    expect(closed.body.error.code).toBe('FY_CLOSED');
  });

  it('round-trips Excel: download the template, fill it, preview, then save', async () => {
    const { piA, grain, trialAId } = await setup();
    const sheet = await piA
      .post('/api/v1/sheets')
      .send({ trialId: trialAId, fyCode: FY, seasonCode: 'KHARIF' })
      .expect(201);
    const id = sheet.body.data.id as string;

    const download = await piA
      .get(`/api/v1/sheets/${id}/template`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(download.body as ArrayBuffer);
    const plot = workbook.getWorksheet('Plot data')!;
    expect(plot.getRow(1).getCell(3).value).toBe('Grain yield (KG_HA) [GRAIN_YIELD]');
    expect(plot.rowCount).toBe(1 + 3 * 3); // header + treatments × replications

    const yields = [10, 12, 11, 14, 15, 16, 9, 8, 'abc'];
    for (let i = 0; i < 9; i++) plot.getRow(i + 2).getCell(3).value = yields[i] as number | string;
    workbook.getWorksheet('Treatment data')!.getRow(3).getCell(2).value = 45000;
    const bad = Buffer.from(await workbook.xlsx.writeBuffer());
    const preview = await piA
      .post(`/api/v1/sheets/${id}/import?dryRun=false`)
      .attach('file', bad, 'data.xlsx')
      .expect(200);
    expect(preview.body.data).toMatchObject({
      dryRun: true,
      errors: [expect.objectContaining({ row: 10, field: 'GRAIN_YIELD' })],
    });

    plot.getRow(10).getCell(3).value = 10;
    const good = Buffer.from(await workbook.xlsx.writeBuffer());
    const saved = await piA
      .post(`/api/v1/sheets/${id}/import?dryRun=false`)
      .attach('file', good, 'data.xlsx')
      .expect(200);
    expect(saved.body.data).toMatchObject({ dryRun: false, filled: 10, errors: [] });

    const detail = await piA.get(`/api/v1/sheets/${id}`).expect(200);
    expect(
      detail.body.data.values.filter((v: { parameterId: string }) => v.parameterId === grain.id),
    ).toHaveLength(9);

    const analysis = await piA.get(`/api/v1/sheets/${id}/analysis`).expect(200);
    const grainResult = analysis.body.data.parameters.find((p: { code: string }) => p.code === 'GRAIN_YIELD');
    expect(grainResult.means.map((m: { mean: number }) => m.mean)).toEqual([11, 15, 9]);
    expect(grainResult.anova.significant).toBe(true);
  });

  it('summarises approved data across centres', async () => {
    const { pcu, piA, piB, grain, experimentId, centreA } = await setup();
    const trials = await pcu.get(`/api/v1/trials?experimentId=${experimentId}`).expect(200);
    const trialOf = (centreId: string) =>
      trials.body.data.find((t: { centreId: { id: string } }) => t.centreId.id === centreId);
    const trialA = trialOf(centreA.id);
    const trialB = trials.body.data.find((t: { id: string }) => t.id !== trialA.id);
    for (const [centrePi, trial, base] of [
      [piA, trialA, 3000],
      [piB, trialB, 4000],
    ] as const) {
      const sheet = await centrePi
        .post('/api/v1/sheets')
        .send({ trialId: trial.id, fyCode: FY, seasonCode: 'KHARIF' })
        .expect(201);
      await centrePi
        .put(`/api/v1/sheets/${sheet.body.data.id}/values`)
        .send({
          values: fullPlotData(grain.id, {
            T1: [base, base, base],
            T2: [base + 600, base + 600, base + 600],
            T3: [base + 300, base + 300, base + 300],
          }),
        })
        .expect(200);
      await centrePi.post(`/api/v1/sheets/${sheet.body.data.id}/submit`).send({}).expect(200);
      await pcu.post(`/api/v1/sheets/${sheet.body.data.id}/approve`).send({}).expect(200);
    }
    const summary = await pcu
      .get(`/api/v1/sheets/summary?experimentId=${experimentId}&fyCode=${FY}`)
      .expect(200);
    expect(summary.body.data.centres).toHaveLength(2);
    const means = summary.body.data.centres
      .map((c: { means: Record<string, Record<string, number>> }) => c.means[grain.id]!.T2)
      .sort();
    expect(means).toEqual([3600, 4600]);
    // Pooled over the two centres; every plot within a centre has the same value, so there is no error.
    expect(summary.body.data.pooled[grain.id]).toEqual({
      reason: 'No residual variation (pooled error mean square is 0)',
    });
    expect(summary.body.data.experiment).toMatchObject({ design: 'RBD', referenceTreatmentCode: null });
    expect(summary.body.data.centres[0]).toHaveProperty('croppingSystemName', null);

    const mine = await piA
      .get(`/api/v1/sheets/summary?experimentId=${experimentId}&fyCode=${FY}`)
      .expect(200);
    expect(mine.body.data.centres).toHaveLength(1);
  });
});

describe('reference treatment', () => {
  it('must be one of the experiment’s treatments, also after treatments change', async () => {
    const { pcu, experimentId } = await setup();
    const bad = await pcu
      .patch(`/api/v1/experiments/${experimentId}`)
      .send({ referenceTreatmentCode: 'T9' })
      .expect(400);
    expect(bad.body.error.code).toBe('UNKNOWN_REFERENCE_TREATMENT');
    const ok = await pcu
      .patch(`/api/v1/experiments/${experimentId}`)
      .send({ referenceTreatmentCode: 't3' })
      .expect(200);
    expect(ok.body.data.referenceTreatmentCode).toBe('T3');
    // Removing the reference treatment without changing the reference is refused.
    await pcu
      .patch(`/api/v1/experiments/${experimentId}`)
      .send({
        treatments: [
          { code: 'T1', name: 'Control' },
          { code: 'T2', name: 'Complete NF' },
        ],
      })
      .expect(400);
    await pcu.patch(`/api/v1/experiments/${experimentId}`).send({ referenceTreatmentCode: null }).expect(200);
  });
});

describe('calculated parameters', () => {
  it('checks formulas in the library: syntax, known number parameters, no loops', async () => {
    const { pcu } = await setup();
    const add = (code: string, formula: string, extra = {}) =>
      pcu
        .post('/api/v1/parameters')
        .send({ code, name: `Param ${code}`, category: 'Economics', formula, ...extra });
    expect((await add('BAD', 'GRAIN_YIELD +').expect(400)).body.error.code).toBe('INVALID_FORMULA');
    expect((await add('BAD', 'NOPE * 2').expect(400)).body.error.message).toContain(
      'NOPE is not in the parameter library',
    );
    await add('TXT', 'GRAIN_YIELD', { dataType: 'text' }).expect(400);
    const a = await add('A_CALC', 'GRAIN_YIELD * 2').expect(201);
    await add('B_CALC', 'A_CALC + 1').expect(201);
    const loop = await pcu
      .patch(`/api/v1/parameters/${a.body.data.id}`)
      .send({ formula: 'B_CALC - 1' })
      .expect(400);
    expect(loop.body.error.message).toContain('loop');
  });

  it('computes values from entered ones (mixing plot and treatment levels) and never lets them be typed', async () => {
    const { pcu, piA, grain, experimentId, trialAId } = await setup();
    const make = async (body: Record<string, unknown>) =>
      (
        await pcu
          .post('/api/v1/parameters')
          .send({ category: 'Economics', ...body })
          .expect(201)
      ).body.data;
    const price = await make({ code: 'SALE_PRICE_MAIN', name: 'Sale price', min: 0 });
    const cost = await make({ code: 'COST_CULTIVATION', name: 'Cost of cultivation', min: 0 });
    const net = await make({
      code: 'NET_CALC',
      name: 'Net returns (calc)',
      decimals: 0,
      formula: 'GRAIN_YIELD * SALE_PRICE_MAIN - COST_CULTIVATION',
    });
    const bc = await make({
      code: 'BC_CALC',
      name: 'B:C (calc)',
      decimals: 2,
      formula: 'NET_CALC / COST_CULTIVATION',
    });

    const experiment = (await pcu.get(`/api/v1/experiments/${experimentId}`).expect(200)).body.data;
    const keep = experiment.parameters.map(
      (p: { parameterId: string; section: string; level: string; required: boolean }) => ({
        parameterId: p.parameterId,
        section: p.section,
        level: p.level,
        required: p.required,
      }),
    );
    await pcu
      .patch(`/api/v1/experiments/${experimentId}`)
      .send({
        parameters: [
          ...keep,
          { parameterId: price.id, section: 'Economics', level: 'treatment' },
          { parameterId: cost.id, section: 'Economics', level: 'treatment' },
          { parameterId: net.id, section: 'Economics', level: 'treatment', required: true },
          { parameterId: bc.id, section: 'Economics', level: 'treatment' },
        ],
      })
      .expect(200);

    const sheet = await piA
      .post('/api/v1/sheets')
      .send({ trialId: trialAId, fyCode: FY, seasonCode: 'KHARIF' })
      .expect(201);
    const id = sheet.body.data.id as string;
    const perTreatment = (parameterId: string, values: number[]) =>
      ['T1', 'T2', 'T3'].map((t, i) => ({
        treatmentCode: t,
        replication: null,
        parameterId,
        value: values[i]!,
      }));
    await piA
      .put(`/api/v1/sheets/${id}/values`)
      .send({
        values: [
          ...fullPlotData(grain.id, {
            T1: [4000, 4200, 4100],
            T2: [3500, 3600, 3400],
            T3: [3800, 3900, 3700],
          }),
          ...perTreatment(price.id, [20, 25, 22]),
          ...perTreatment(cost.id, [50000, 40000, 45000]),
        ],
      })
      .expect(200);

    // A calculated value can't be typed in.
    const typed = await piA
      .put(`/api/v1/sheets/${id}/values`)
      .send({ values: [{ treatmentCode: 'T1', replication: null, parameterId: net.id, value: 1 }] })
      .expect(400);
    expect(typed.body.error.code).toBe('INVALID_VALUES');

    // T1: mean yield 4100 × 20 − 50000 = 32000; B:C = 32000 / 50000 = 0.64.
    const detail = await piA.get(`/api/v1/sheets/${id}`).expect(200);
    const valueOf = (pid: string, t: string) =>
      detail.body.data.values.find(
        (v: { parameterId: string; treatmentCode: string }) => v.parameterId === pid && v.treatmentCode === t,
      );
    expect(valueOf(net.id, 'T1')).toMatchObject({ value: 32000, calculated: true });
    expect(valueOf(bc.id, 'T1').value).toBe(0.64);
    expect(valueOf(net.id, 'T2').value).toBe(3500 * 25 - 40000);

    // Required but calculated: submitting doesn't ask for it to be typed.
    await piA.post(`/api/v1/sheets/${id}/submit`).send({}).expect(200);

    const analysis = await piA.get(`/api/v1/sheets/${id}/analysis`).expect(200);
    const bcResult = analysis.body.data.parameters.find((p: { code: string }) => p.code === 'BC_CALC');
    expect(bcResult.means.map((m: { mean: number }) => m.mean)).toEqual([0.64, 1.19, 0.86]);

    // The Excel template has no column for calculated parameters.
    const template = await piA
      .get(`/api/v1/sheets/${id}/template`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(template.body as ArrayBuffer);
    const headers = (workbook.getWorksheet('Treatment data')!.getRow(1).values as unknown[]).map(String);
    expect(headers.some((h) => h.includes('NET_CALC') || h.includes('BC_CALC'))).toBe(false);
    expect(headers.some((h) => h.includes('SALE_PRICE_MAIN'))).toBe(true);
  });
});

describe('reporting status', () => {
  it('lists each assigned centre × year × season with its sheets; a PI sees only their own centre', async () => {
    const { pcu, piA, experimentId, trialAId, centreA } = await setup();
    await piA
      .post('/api/v1/sheets')
      .send({ trialId: trialAId, fyCode: FY, seasonCode: 'KHARIF' })
      .expect(201);

    const all = await pcu.get(`/api/v1/sheets/reporting?experimentId=${experimentId}`).expect(200);
    expect(all.body.data).toMatchObject({ years: [FY], seasons: ['KHARIF'], openYears: [FY] });
    expect(all.body.data.centres).toHaveLength(2);
    const a = all.body.data.centres.find((c: { centre: { id: string } }) => c.centre.id === centreA.id);
    expect(a.sheets).toEqual([
      expect.objectContaining({ fyCode: FY, seasonCode: 'KHARIF', status: 'Draft' }),
    ]);
    const b = all.body.data.centres.find((c: { centre: { id: string } }) => c.centre.id !== centreA.id);
    expect(b.sheets).toEqual([]);

    const mine = await piA.get(`/api/v1/sheets/reporting?experimentId=${experimentId}`).expect(200);
    expect(mine.body.data.centres.map((c: { centre: { id: string } }) => c.centre.id)).toEqual([centreA.id]);

    // A centre that is no longer assigned drops out of the grid.
    await pcu
      .patch(`/api/v1/experiments/${experimentId}`)
      .send({ centreIds: [centreA.id] })
      .expect(200);
    const after = await pcu.get(`/api/v1/sheets/reporting?experimentId=${experimentId}`).expect(200);
    expect(after.body.data.centres).toHaveLength(1);
  });
});

describe('sheet audit history', () => {
  it('records every changed cell (old → new), how it came in, and the centre', async () => {
    const { piA, grain, trialAId, centreA } = await setup();
    const sheet = await piA
      .post('/api/v1/sheets')
      .send({ trialId: trialAId, fyCode: FY, seasonCode: 'KHARIF' })
      .expect(201);
    const id = sheet.body.data.id as string;
    const values = fullPlotData(grain.id, { T1: [10, 12, 11], T2: [14, 16, 15], T3: [8, 10, 9] });
    await piA.put(`/api/v1/sheets/${id}/values`).send({ values }).expect(200);

    // Same values again plus one real change: only that cell is recorded.
    const again = values.map((v) =>
      v.treatmentCode === 'T2' && v.replication === 3 ? { ...v, value: 17 } : v,
    );
    await piA.put(`/api/v1/sheets/${id}/values`).send({ values: again }).expect(200);

    const history = await piA.get(`/api/v1/audit?entityId=${id}&sort=createdAt`).expect(200);
    const [opened, first, second] = history.body.data;
    expect(opened.action).toMatch(/^Opened sheet/);
    expect(first).toMatchObject({ action: 'Saved sheet: 9 values changed', source: 'form' });
    expect(first.centreId.id).toBe(centreA.id);
    expect(first.cells[0]).toEqual({
      treatmentCode: 'T1',
      replication: 1,
      parameterCode: 'GRAIN_YIELD',
      from: null,
      to: 10,
    });
    expect(second).toMatchObject({
      action: 'Saved sheet: 1 value changed',
      cells: [{ treatmentCode: 'T2', replication: 3, parameterCode: 'GRAIN_YIELD', from: 15, to: 17 }],
    });

    // An Excel import is marked as such.
    const download = await piA
      .get(`/api/v1/sheets/${id}/template`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(download.body as ArrayBuffer);
    workbook.getWorksheet('Plot data')!.getRow(2).getCell(3).value = 11; // T1 R1: 10 → 11
    await piA
      .post(`/api/v1/sheets/${id}/import?dryRun=false`)
      .attach('file', Buffer.from(await workbook.xlsx.writeBuffer()), 'data.xlsx')
      .expect(200);
    const latest = await piA.get(`/api/v1/audit?entityId=${id}&limit=1`).expect(200);
    expect(latest.body.data[0]).toMatchObject({
      action: 'Imported Excel: 1 value changed',
      source: 'excel',
      cells: [{ treatmentCode: 'T1', replication: 1, parameterCode: 'GRAIN_YIELD', from: 10, to: 11 }],
    });
  });
});

describe('experiment designs', () => {
  it('applies each design’s replication rule', async () => {
    const { pcu } = await setup();
    const base = { title: 'Design rules experiment', programmeCode: 'P2', startYear: FY };
    // Split plot needs replications, like RBD.
    await pcu
      .post('/api/v1/experiments')
      .send({ ...base, code: 'SP1', design: 'Split plot', replications: 1 })
      .expect(400);
    // Farmer-participatory trials are never replicated: replications sent are dropped.
    const fp = await pcu
      .post('/api/v1/experiments')
      .send({ ...base, code: 'FP1', design: 'Farmer participatory', replications: 3 })
      .expect(201);
    expect(fp.body.data.replications).toBeNull();
    // Strip plot occurs both un-replicated and replicated in the reports.
    const stripNone = await pcu
      .post('/api/v1/experiments')
      .send({ ...base, code: 'ST1', design: 'Strip plot' })
      .expect(201);
    expect(stripNone.body.data.replications).toBeNull();
    const stripReps = await pcu
      .post('/api/v1/experiments')
      .send({ ...base, code: 'ST2', design: 'Strip plot', replications: 3 })
      .expect(201);
    expect(stripReps.body.data.replications).toBe(3);
    // An update is checked against the saved experiment: switching a Strip plot without
    // replications to RBD needs replications; switching an RBD to Split plot keeps its 3.
    const toRbd = await pcu
      .patch(`/api/v1/experiments/${stripNone.body.data.id}`)
      .send({ design: 'RBD' })
      .expect(400);
    expect(toRbd.body.error.code).toBe('REPLICATIONS_REQUIRED');
    await pcu.patch(`/api/v1/experiments/${stripReps.body.data.id}`).send({ design: 'RBD' }).expect(200);
    await pcu.patch(`/api/v1/experiments/${stripReps.body.data.id}`).send({ replications: 1 }).expect(400);
    // Old names are no longer accepted.
    await pcu
      .post('/api/v1/experiments')
      .send({ ...base, code: 'OLD', design: 'RCBD', replications: 3 })
      .expect(400);
  });

  it('runs the ANOVA only for RBD; a split-plot sheet gets treatment means only', async () => {
    const { pcu, piA, grain, experimentId, trialAId } = await setup();
    await pcu.patch(`/api/v1/experiments/${experimentId}`).send({ design: 'Split plot' }).expect(200);
    const sheet = await piA
      .post('/api/v1/sheets')
      .send({ trialId: trialAId, fyCode: FY, seasonCode: 'KHARIF' })
      .expect(201);
    await piA
      .put(`/api/v1/sheets/${sheet.body.data.id}/values`)
      .send({ values: fullPlotData(grain.id, { T1: [10, 13, 10], T2: [15, 16, 14], T3: [8, 9, 10] }) })
      .expect(200);
    const analysis = await piA.get(`/api/v1/sheets/${sheet.body.data.id}/analysis`).expect(200);
    const result = analysis.body.data.parameters.find((p: { code: string }) => p.code === 'GRAIN_YIELD');
    expect(result.means.map((m: { mean: number }) => m.mean)).toEqual([11, 15, 9]);
    expect(result.anova).toBeNull();
    expect(result.reason).toContain('split plot');
  });
});

describe('RCBD analysis', () => {
  it('matches a hand-worked example (3 treatments × 3 replications)', () => {
    // T1: 10 12 11 | T2: 14 15 16 | T3: 9 8 10
    // CF = 1225; SS total 62; SS treatments 56; SS reps 2.667; SS error 3.333; MSE 0.8333 (df 4)
    const values = new Map([
      [
        'T1',
        new Map([
          [1, 10],
          [2, 12],
          [3, 11],
        ]),
      ],
      [
        'T2',
        new Map([
          [1, 14],
          [2, 15],
          [3, 16],
        ]),
      ],
      [
        'T3',
        new Map([
          [1, 9],
          [2, 8],
          [3, 10],
        ]),
      ],
    ]) as Map<string, Map<number | null, number>>;
    const result = analyseParameter(values, ['T1', 'T2', 'T3'], 3);
    expect(result.means.map((m) => m.mean)).toEqual([11, 15, 9]);
    const a = result.anova!;
    const row = (s: string) => a.table.find((r) => r.source === s)!;
    expect(row('Treatments')).toMatchObject({ df: 2, ss: 56, ms: 28 });
    expect(row('Replications').ss).toBeCloseTo(2.6667, 3);
    expect(row('Error')).toMatchObject({ df: 4 });
    expect(row('Error').ms).toBeCloseTo(0.8333, 3);
    expect(row('Treatments').f).toBeCloseTo(33.6, 3);
    expect(row('Treatments').p).toBeLessThan(0.01);
    expect(a.cv).toBeCloseTo(7.82, 2);
    expect(a.sem).toBeCloseTo(0.527, 3);
    expect(a.sed).toBeCloseTo(0.7454, 3);
    expect(a.cd5).toBeCloseTo(2.0694, 3); // t(0.975, 4) = 2.7764
    expect(a.significant).toBe(true);
    // DMRT: Duncan's ranges for 4 error df are 3.93 (p = 2) and 4.01 (p = 3), × SEm 0.527 = 2.07 and 2.11.
    // T2 (15) differs from T1 (11) and T3 (9); T1 − T3 = 2 is within 2.07, so they share a letter.
    expect(a.groups).toEqual({ T2: 'a', T1: 'b', T3: 'b' });
  });

  it('pools RBDs over locations (values checked by an independent calculation)', () => {
    const result = pooledAnalysis(
      [
        {
          label: 'A',
          grid: [
            [10, 12, 11],
            [14, 16, 15],
            [8, 10, 10],
          ],
        },
        {
          label: 'B',
          grid: [
            [13, 12, 14],
            [15, 17, 16],
            [12, 11, 13],
          ],
        },
      ],
      ['T1', 'T2', 'T3'],
    );
    if ('reason' in result) throw new Error(result.reason);
    const row = (s: string) => result.table.find((r) => r.source === s)!;
    expect(row('Locations')).toMatchObject({ df: 1 });
    expect(row('Locations').ss).toBeCloseTo(16.0556, 3);
    expect(row('Replications within locations').ss).toBeCloseTo(8.2222, 3);
    expect(row('Treatments').ss).toBeCloseTo(74.7778, 3);
    expect(row('Treatments × Locations').ss).toBeCloseTo(2.1111, 3);
    expect(row('Pooled error')).toMatchObject({ df: 8 });
    expect(row('Pooled error').ss).toBeCloseTo(4.4444, 3);
    expect(row('Total').ss).toBeCloseTo(105.6111, 3);
    // Treatments are tested against the T × L mean square; T × L against the pooled error.
    expect(row('Treatments').f).toBeCloseTo(35.4211, 3);
    expect(row('Treatments × Locations').f).toBeCloseTo(1.9, 3);
    expect(result.means.map((m) => m.mean)).toEqual([12, 15.5, 10.6667]);
    expect(result.cv).toBeCloseTo(5.86, 2);
    expect(result.sem).toBeCloseTo(0.4194, 3);
    expect(result.sed).toBeCloseTo(0.5932, 3);
    expect(result.cd5).toBeCloseTo(2.5523, 3); // t(0.975, 2) = 4.3027
    expect(result).toMatchObject({ significant: true, interactionSignificant: false });
    expect(result.groups).toEqual({ T2: 'a', T1: 'b', T3: 'b' });
    expect(result.bartlett.chiSquare).toBeCloseTo(3.6325, 3);
    expect(result.bartlett.homogeneous).toBe(true);

    expect(
      pooledAnalysis(
        [
          {
            label: 'A',
            grid: [
              [1, 2],
              [3, 4],
            ],
          },
        ],
        ['T1', 'T2'],
      ),
    ).toEqual({
      reason: 'Needs complete data from at least 2 locations',
    });
  });

  it('gives overlapping DMRT groups (Duncan table, 10 error df)', () => {
    // r_p for 10 df: 3.15, 3.29, 3.38 (× SEm 1). 20 vs 16.5 (3.5 > 3.29) differ; neighbours don't.
    const letters = dmrtLetters(
      [
        { treatmentCode: 'T1', mean: 14 },
        { treatmentCode: 'T2', mean: 20 },
        { treatmentCode: 'T3', mean: 16.5 },
        { treatmentCode: 'T4', mean: 18 },
      ],
      1,
      10,
    );
    expect(letters).toEqual({ T2: 'a', T4: 'ab', T3: 'bc', T1: 'c' });
  });

  it('gives means only when data is incomplete or not replicated', () => {
    const values = new Map([
      ['T1', new Map([[1, 10]])],
      [
        'T2',
        new Map([
          [1, 12],
          [2, 13],
        ]),
      ],
    ]) as Map<string, Map<number | null, number>>;
    expect(analyseParameter(values, ['T1', 'T2'], 2)).toMatchObject({
      anova: null,
      reason: 'Incomplete data: T1 R2 missing',
    });
    expect(analyseParameter(values, ['T1', 'T2'], null)).toMatchObject({
      anova: null,
      reason: 'Not a replicated design',
    });
  });
});

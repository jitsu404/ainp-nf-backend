import { describe, expect, it } from 'vitest';
import { ExperimentModel } from '../src/modules/experiments/experiments.model.js';
import { MasterItemModel } from '../src/modules/masters/masters.model.js';
import { ParameterModel } from '../src/modules/parameters/parameters.model.js';
import { createCentre, signedInAgent } from './helpers.js';

const setup = async () => {
  await MasterItemModel.insertMany([
    { type: 'season', code: 'KHARIF', name: 'Kharif' },
    { type: 'season', code: 'RABI', name: 'Rabi' },
    { type: 'programme', code: 'P2', name: 'Package of practices' },
    { type: 'crop', code: 'RICE', name: 'Rice', group: 'Cereal' },
    { type: 'crop', code: 'SOY', name: 'Soybean', group: 'Oilseed' },
    { type: 'crop', code: 'PIGEON', name: 'Pigeonpea', group: 'Pulse' },
    { type: 'crop', code: 'WHEAT', name: 'Wheat', group: 'Cereal' },
    { type: 'unit', code: 'KG_HA', name: 'kg/ha' },
  ]);
  const centre = await createCentre();
  const { agent: pcu } = await signedInAgent('pc');
  const { agent: pi } = await signedInAgent('pi', centre.id);
  return { pcu, pi, centre };
};

const riceSoy = { seasonCode: 'KHARIF', mainCropCode: 'RICE', intercropCodes: ['SOY'] };

describe('cropping systems master', () => {
  it('adds one season, a main crop and intercrops, with a generated code and name', async () => {
    const { pcu, pi } = await setup();
    const created = await pcu.post('/api/v1/cropping-systems').send(riceSoy).expect(201);
    expect(created.body.data).toMatchObject({
      code: 'CSY-001',
      name: 'Rice + Soybean',
      seasonCode: 'KHARIF',
      mainCropCode: 'RICE',
      intercropCodes: ['SOY'],
      isActive: true,
    });
    const list = await pi.get('/api/v1/cropping-systems?isActive=true').expect(200);
    expect(list.body.data).toHaveLength(1);

    // A made name follows the crops; a typed one stays.
    const more = await pcu
      .patch(`/api/v1/cropping-systems/${created.body.data.id}`)
      .send({ intercropCodes: ['SOY', 'PIGEON'] })
      .expect(200);
    expect(more.body.data.name).toBe('Rice + Soybean + Pigeonpea');
    await pcu
      .patch(`/api/v1/cropping-systems/${created.body.data.id}`)
      .send({ name: 'Rice-based intercropping' })
      .expect(200);
    const kept = await pcu
      .patch(`/api/v1/cropping-systems/${created.body.data.id}`)
      .send({ intercropCodes: ['SOY'] })
      .expect(200);
    expect(kept.body.data.name).toBe('Rice-based intercropping');
  });

  it('allows several systems with the same season and main crop', async () => {
    const { pcu } = await setup();
    await pcu.post('/api/v1/cropping-systems').send(riceSoy).expect(201);
    await pcu.post('/api/v1/cropping-systems').send(riceSoy).expect(201);
    const alone = await pcu
      .post('/api/v1/cropping-systems')
      .send({ seasonCode: 'KHARIF', mainCropCode: 'RICE' })
      .expect(201);
    expect(alone.body.data).toMatchObject({ code: 'CSY-003', name: 'Rice', intercropCodes: [] });
  });

  it('only masters.edit may change the list', async () => {
    const { pi } = await setup();
    await pi.post('/api/v1/cropping-systems').send(riceSoy).expect(403);
  });

  it('refuses unknown crops and seasons, and a crop repeated as an intercrop', async () => {
    const { pcu } = await setup();
    const unknown = await pcu
      .post('/api/v1/cropping-systems')
      .send({ seasonCode: 'KHARIF', mainCropCode: 'MANGO' })
      .expect(400);
    expect(unknown.body.error.code).toBe('UNKNOWN_CROP');
    await pcu
      .post('/api/v1/cropping-systems')
      .send({ seasonCode: 'KHARIF', mainCropCode: 'RICE', intercropCodes: ['RICE'] })
      .expect(400);
    const season = await pcu
      .post('/api/v1/cropping-systems')
      .send({ seasonCode: 'SUMMER', mainCropCode: 'RICE' })
      .expect(400);
    expect(season.body.error.code).toBe('UNKNOWN_SEASON');
  });

  it('is chosen as a sub plot of a split plot, and each centre records how it grows it', async () => {
    const { pcu, pi, centre } = await setup();
    const system = (await pcu.post('/api/v1/cropping-systems').send(riceSoy).expect(201)).body.data;
    const grain = await ParameterModel.create({
      code: 'GRAIN_YIELD',
      name: 'Grain yield',
      unitCode: 'KG_HA',
      category: 'Yield',
    });
    const base = {
      title: 'Cropping systems under natural farming',
      programmeCode: 'P2',
      replications: 3,
      defaultParameters: [{ parameterId: grain.id }],
      seasons: ['KHARIF', 'RABI'],
      startYear: 2026,
      endYear: 2028,
    };
    const rbd = await pcu
      .post('/api/v1/experiments')
      .send({
        ...base,
        design: 'RBD',
        treatments: [{ code: 'T1', name: 'A' }],
        subPlotData: [{ code: 'S1', croppingSystems: [{ seasonCode: 'KHARIF', croppingSystem: system.id }] }],
      })
      .expect(400);
    expect(rbd.body.error.code).toBe('CROPPING_SYSTEM_NOT_ALLOWED');

    const experiment = await pcu
      .post('/api/v1/experiments')
      .send({
        ...base,
        design: 'Split plot',
        mainPlotCount: 2,
        subPlotCount: 1,
        mainPlotData: [
          { code: 'M1', name: 'Organic' },
          { code: 'M2', name: 'Natural farming' },
        ],
        subPlotData: [{ code: 'S1', croppingSystems: [{ seasonCode: 'KHARIF', croppingSystem: system.id }] }],
        treatments: [
          { code: 'T1', name: 'M1 S1', mainPlotCode: 'M1', subPlotCode: 'S1' },
          { code: 'T2', name: 'M2 S1', mainPlotCode: 'M2', subPlotCode: 'S1' },
        ],
        centreIds: [centre.id],
      })
      .expect(201);
    expect(experiment.body.data.subPlotData[0].croppingSystems).toEqual([
      { seasonCode: 'KHARIF', croppingSystem: system.id },
    ]);

    const experimentId = experiment.body.data.id as string;
    const wheat = (
      await pcu
        .post('/api/v1/cropping-systems')
        .send({ seasonCode: 'RABI', mainCropCode: 'WHEAT' })
        .expect(201)
    ).body.data;

    // A sub plot's system must be one of that season's.
    const mismatch = await pcu
      .patch(`/api/v1/experiments/${experimentId}`)
      .send({
        subPlotData: [{ code: 'S1', croppingSystems: [{ seasonCode: 'KHARIF', croppingSystem: wheat.id }] }],
      })
      .expect(400);
    expect(mismatch.body.error.code).toBe('SEASON_MISMATCH');

    const trials = await pi.get(`/api/v1/trials?experimentId=${experimentId}`).expect(200);
    const trialId = trials.body.data[0].id as string;
    const grown = {
      croppingSystemId: system.id,
      sowingDate: '2026-06-20',
      harvestDate: '2026-10-25',
      crops: [
        {
          cropCode: 'RICE',
          role: 'main',
          variety: 'PB 1509',
          plantSpacing: 15,
          rowSpacing: 20,
          rowRatio: 2,
          seedRate: 40,
        },
        { cropCode: 'SOY', role: 'intercrop', variety: 'JS 335', rowSpacing: 30, rowRatio: 1, seedRate: 60 },
      ],
    };
    const saved = await pi
      .patch(`/api/v1/trials/${trialId}`)
      .send({ croppingSystems: [grown] })
      .expect(200);
    expect(saved.body.data.croppingSystems[0]).toMatchObject({
      croppingSystemId: system.id,
      crops: [{ cropCode: 'RICE', variety: 'PB 1509', rowRatio: 2 }, { cropCode: 'SOY' }],
    });

    // The master fixes the crops.
    const wrong = await pi
      .patch(`/api/v1/trials/${trialId}`)
      .send({
        croppingSystems: [{ croppingSystemId: system.id, crops: [{ cropCode: 'RICE', role: 'main' }] }],
      })
      .expect(400);
    expect(wrong.body.error.code).toBe('CROPS_NOT_IN_SYSTEM');

    // The experiment's choices take priority and reach the trial; seasons it leaves empty keep the
    // centre's own choice.
    await pi
      .patch(`/api/v1/trials/${trialId}`)
      .send({
        subPlotData: [
          {
            code: 'S1',
            croppingSystems: [
              { seasonCode: 'KHARIF', croppingSystem: system.id },
              { seasonCode: 'RABI', croppingSystem: wheat.id },
            ],
          },
        ],
      })
      .expect(200);
    const riceAlone = (
      await pcu
        .post('/api/v1/cropping-systems')
        .send({ seasonCode: 'KHARIF', mainCropCode: 'RICE' })
        .expect(201)
    ).body.data;
    await pcu
      .patch(`/api/v1/experiments/${experimentId}`)
      .send({
        subPlotData: [
          { code: 'S1', croppingSystems: [{ seasonCode: 'KHARIF', croppingSystem: riceAlone.id }] },
        ],
      })
      .expect(200);
    const pushed = await pi.get(`/api/v1/trials/${trialId}`).expect(200);
    expect(pushed.body.data.subPlotData[0].croppingSystems).toEqual(
      expect.arrayContaining([
        { seasonCode: 'KHARIF', croppingSystem: riceAlone.id },
        { seasonCode: 'RABI', croppingSystem: wheat.id },
      ]),
    );

    // Once data is recorded, a season's choice can't change (it can still be set where empty).
    await ExperimentModel.updateOne({ _id: experimentId }, { dataLocked: true });
    const history = await pcu
      .patch(`/api/v1/experiments/${experimentId}`)
      .send({
        subPlotData: [{ code: 'S1', croppingSystems: [{ seasonCode: 'KHARIF', croppingSystem: system.id }] }],
      })
      .expect(409);
    expect(history.body.error.code).toBe('EXPERIMENT_HAS_DATA');
    await ExperimentModel.updateOne({ _id: experimentId }, { dataLocked: false });

    // While the PCU has the sub plots locked, the centre can't change them, nor unlock them itself.
    await pi
      .patch(`/api/v1/trials/${trialId}/lock`)
      .send({ lockedKey: 'subPlot', isLocked: false })
      .expect(403);
    await pcu
      .patch(`/api/v1/trials/${trialId}/lock`)
      .send({ lockedKey: 'subPlot', isLocked: true })
      .expect(200);
    const locked = await pi
      .patch(`/api/v1/trials/${trialId}`)
      .send({ subPlotData: [{ code: 'S1', croppingSystems: [] }] })
      .expect(409);
    expect(locked.body.error.code).toBe('SECTION_LOCKED');
    await pi.patch(`/api/v1/trials/${trialId}`).send({ status: 'Running' }).expect(200);

    // A deactivated system stays where it is used, but can't be newly chosen.
    await pcu.patch(`/api/v1/cropping-systems/${system.id}`).send({ isActive: false }).expect(200);
    await pi
      .patch(`/api/v1/trials/${trialId}`)
      .send({ croppingSystems: [grown] })
      .expect(200);
    const other = (
      await pcu
        .post('/api/v1/cropping-systems')
        .send({ seasonCode: 'RABI', mainCropCode: 'WHEAT' })
        .expect(201)
    ).body.data;
    await pcu.patch(`/api/v1/cropping-systems/${other.id}`).send({ isActive: false }).expect(200);
    const inactive = await pi
      .patch(`/api/v1/trials/${trialId}`)
      .send({ croppingSystems: [{ croppingSystemId: other.id }] })
      .expect(400);
    expect(inactive.body.error.code).toBe('UNKNOWN_CROPPING_SYSTEM');
  });
});

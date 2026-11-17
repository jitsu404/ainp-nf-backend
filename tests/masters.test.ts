import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { FinancialYearModel } from '../src/modules/financialYears/financialYears.model.js';
import { MasterItemModel } from '../src/modules/masters/masters.model.js';
import {
  MASTER_DEFAULTS,
  MASTER_TYPES,
  type MasterDefault,
  type MasterType,
} from '../src/modules/masters/masters.types.js';
import { buildWorkbook } from '../src/utils/excel.js';
import { createCentre, signedInAgent } from './helpers.js';

const xlsx = (rows: Record<string, unknown>[], headers?: string[]) => {
  // Every column used in any row, in first-seen order.
  const keys = headers ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return buildWorkbook(
    'Sheet',
    keys.map((k) => ({ key: k, header: k })),
    rows,
  );
};

describe('masters', () => {
  it('lets the PCU add and edit items; everyone signed in can read', async () => {
    const { agent } = await signedInAgent('pc');

    const created = await agent
      .post('/api/v1/masters/season')
      .send({ code: 'kharif', name: 'Kharif' })
      .expect(201);
    expect(created.body.data).toMatchObject({ type: 'season', code: 'KHARIF', isActive: true });
    await agent.patch(`/api/v1/masters/season/${created.body.data.id}`).send({ isActive: false }).expect(200);

    const centre = await createCentre();
    const { agent: pi } = await signedInAgent('pi', centre.id);
    const list = await pi.get('/api/v1/masters/season').expect(200);
    expect(list.body.data).toHaveLength(1);
    await pi.post('/api/v1/masters/season').send({ code: 'RABI', name: 'Rabi' }).expect(403);
  });

  it('enforces allowed groups and unique codes per type', async () => {
    const { agent } = await signedInAgent('superadmin');
    const bad = await agent
      .post('/api/v1/masters/budgetHead')
      .send({ code: 'RE', name: 'Research', group: 'Misc' })
      .expect(400);
    expect(bad.body.error.code).toBe('INVALID_GROUP');
    await agent
      .post('/api/v1/masters/budgetHead')
      .send({ code: 'RE', name: 'Research', group: 'General' })
      .expect(201);
    await agent
      .post('/api/v1/masters/budgetHead')
      .send({ code: 'RE', name: 'Again', group: 'General' })
      .expect(409);
    // The same code is fine in another type.
    await agent.post('/api/v1/masters/unit').send({ code: 'RE', name: 'Something' }).expect(201);
  });

  it('has a group only for lists that use one (seasons have none; crops have "Crop group")', async () => {
    const { agent } = await signedInAgent('pc');
    const bad = await agent
      .post('/api/v1/masters/season')
      .send({ code: 'KHARIF', name: 'Kharif', group: 'Monsoon' })
      .expect(400);
    expect(bad.body.error.code).toBe('GROUP_NOT_USED');
    await agent.post('/api/v1/masters/season').send({ code: 'KHARIF', name: 'Kharif' }).expect(201);

    const headers = async (type: string) => {
      const res = await agent
        .get(`/api/v1/masters/${type}/import-template`)
        .buffer(true)
        .parse((r, done) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body as ArrayBuffer);
      return (workbook.worksheets[0]!.getRow(1).values as unknown[]).filter(Boolean);
    };
    expect(await headers('season')).toEqual(['Code', 'Name', 'Description', 'Sort order', 'Active']);
    expect(await headers('crop')).toContain('Crop group');
  });

  it('imports from Excel: dry run reports row errors and saves nothing; a clean file saves everything', async () => {
    const { agent } = await signedInAgent('pc');
    await MasterItemModel.create({ type: 'crop', code: 'RICE', name: 'Paddy', group: 'Cereal' });

    const withErrors = await xlsx([
      { Code: 'RICE', Name: 'Rice', 'Crop group': 'Cereal' },
      { Code: 'WHEAT', Name: 'Wheat', 'Crop group': 'Grass' }, // bad group
      { Code: '', Name: 'No code' }, // missing code
      { Code: 'RICE', Name: 'Duplicate' }, // duplicate in file
    ]);
    const preview = await agent
      .post('/api/v1/masters/crop/import?dryRun=false')
      .attach('file', withErrors, 'crops.xlsx')
      .expect(200);
    expect(preview.body.data).toMatchObject({ dryRun: true, total: 4 });
    expect(preview.body.data.errors.map((e: { row: number }) => e.row)).toEqual([3, 4, 5]);
    expect(await MasterItemModel.findOne({ type: 'crop', code: 'RICE' })).toMatchObject({ name: 'Paddy' });

    const clean = await xlsx([
      { Code: 'RICE', Name: 'Rice', 'Crop group': 'Cereal', Active: 'Yes' },
      { Code: 'WHEAT', Name: 'Wheat', 'Crop group': 'Cereal', 'Sort order': '20' },
    ]);
    const dry = await agent
      .post('/api/v1/masters/crop/import')
      .attach('file', clean, 'crops.xlsx')
      .expect(200);
    expect(dry.body.data).toMatchObject({ dryRun: true, created: 1, updated: 1, errors: [] });
    expect(await MasterItemModel.countDocuments({ type: 'crop' })).toBe(1);

    const saved = await agent
      .post('/api/v1/masters/crop/import?dryRun=false')
      .attach('file', clean, 'crops.xlsx')
      .expect(200);
    expect(saved.body.data).toMatchObject({ dryRun: false, created: 1, updated: 1 });
    expect(await MasterItemModel.findOne({ type: 'crop', code: 'RICE' })).toMatchObject({ name: 'Rice' });
    expect(await MasterItemModel.findOne({ type: 'crop', code: 'WHEAT' })).toMatchObject({ sortOrder: 20 });
  });

  it('downloads a pre-filled template and rejects files that are not .xlsx', async () => {
    const { agent } = await signedInAgent('pc');
    await MasterItemModel.create({ type: 'season', code: 'KHARIF', name: 'Kharif' });
    const template = await agent.get('/api/v1/masters/season/import-template').expect(200);
    expect(template.headers['content-type']).toContain('spreadsheetml');
    expect(template.headers['content-disposition']).toContain('masters-season.xlsx');
    // A cross-origin client (VITE_API_BASE_URL on another port) must be able to read the file name.
    const crossOrigin = await agent
      .get('/api/v1/masters/season/import-template')
      .set('Origin', env.CLIENT_ORIGIN)
      .expect(200);
    expect(crossOrigin.headers['access-control-expose-headers']).toContain('Content-Disposition');

    const notExcel = await agent
      .post('/api/v1/masters/season/import')
      .attach('file', Buffer.from('a,b'), 'seasons.csv')
      .expect(400);
    expect(notExcel.body.error.code).toBe('INVALID_FILE');
    const missingColumn = await agent
      .post('/api/v1/masters/season/import')
      .attach('file', await xlsx([{ Name: 'Kharif' }]), 'seasons.xlsx')
      .expect(400);
    expect(missingColumn.body.error.code).toBe('MISSING_COLUMNS');
  });
});

describe('master defaults (seed)', () => {
  it('have unique codes per list, valid codes and allowed groups', () => {
    for (const [type, items] of Object.entries(MASTER_DEFAULTS) as [MasterType, MasterDefault[]][]) {
      const config = MASTER_TYPES[type];
      const codes = items.map((i) => i.code);
      expect(new Set(codes).size, `${type}: duplicate codes`).toBe(codes.length);
      for (const item of items) {
        expect(item.code, `${type}: ${item.code}`).toMatch(/^[A-Z0-9][A-Z0-9_-]{0,29}$/);
        if ('groups' in config) expect(config.groups, `${type}: ${item.code}`).toContain(item.group);
        else expect(item.group, `${type}: ${item.code}`).toBeUndefined();
      }
    }
  });
});

describe('agro-climatic zones', () => {
  it('a centre’s zone must be an active zone from the master list', async () => {
    const { agent } = await signedInAgent('superadmin');
    await MasterItemModel.create({ type: 'zone', code: 'Z05', name: 'Upper Gangetic Plains' });
    const base = { code: 'MDP', name: 'Modipuram', host: 'ICAR-IIFSR', state: 'Uttar Pradesh' };
    const bad = await agent
      .post('/api/v1/centres')
      .send({ ...base, zone: 'Somewhere' })
      .expect(400);
    expect(bad.body.error.code).toBe('UNKNOWN_ZONE');
    const ok = await agent
      .post('/api/v1/centres')
      .send({ ...base, zone: 'Upper Gangetic Plains' })
      .expect(201);
    await agent.patch(`/api/v1/centres/${ok.body.data.id}`).send({ zone: 'Nowhere' }).expect(400);
    // Editing other fields doesn't re-check the zone, and a centre without a zone is allowed.
    await agent.patch(`/api/v1/centres/${ok.body.data.id}`).send({ name: 'Modipuram (PCU)' }).expect(200);
    await agent
      .post('/api/v1/centres')
      .send({ ...base, code: 'NOZ' })
      .expect(201);
  });
});

describe('financial years', () => {
  it('derives dates from the code, keeps one current year, and can close a year', async () => {
    const { agent } = await signedInAgent('pc');
    const a = await agent
      .post('/api/v1/financial-years')
      .send({ code: '2025-26', isCurrent: true })
      .expect(201);
    expect(a.body.data.startDate).toBe('2025-04-01T00:00:00.000Z');
    const b = await agent.post('/api/v1/financial-years').send({ code: '2026-27' }).expect(201);
    await agent.patch(`/api/v1/financial-years/${b.body.data.id}`).send({ isCurrent: true }).expect(200);
    expect(await FinancialYearModel.countDocuments({ isCurrent: true })).toBe(1);
    expect(await FinancialYearModel.findOne({ isCurrent: true })).toMatchObject({ code: '2026-27' });

    const closed = await agent
      .patch(`/api/v1/financial-years/${a.body.data.id}`)
      .send({ isOpen: false })
      .expect(200);
    expect(closed.body.data.isOpen).toBe(false);
    const bad = await agent.post('/api/v1/financial-years').send({ code: '2026-28' }).expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('parameter library', () => {
  it('adds parameters linked to a unit, validates ranges and choices', async () => {
    const { agent } = await signedInAgent('pc');
    await MasterItemModel.create({ type: 'unit', code: 'KG_HA', name: 'kg/ha' });

    const p = await agent
      .post('/api/v1/parameters')
      .send({
        code: 'grain_yield',
        name: 'Grain yield',
        unitCode: 'KG_HA',
        category: 'Yield',
        min: 0,
        max: 20000,
      })
      .expect(201);
    expect(p.body.data).toMatchObject({ code: 'GRAIN_YIELD', dataType: 'number', unitCode: 'KG_HA' });

    const unknownUnit = await agent
      .post('/api/v1/parameters')
      .send({ code: 'X', name: 'Xyz', unitCode: 'NOPE', category: 'Yield' })
      .expect(400);
    expect(unknownUnit.body.error.code).toBe('UNKNOWN_UNIT');
    await agent
      .post('/api/v1/parameters')
      .send({ code: 'Y', name: 'Yyy', category: 'Yield', min: 5, max: 1 })
      .expect(400);
    await agent
      .post('/api/v1/parameters')
      .send({ code: 'Z', name: 'Zzz', category: 'Other', dataType: 'choice' })
      .expect(400);
  });

  it('imports parameters from Excel with unit checks', async () => {
    const { agent } = await signedInAgent('superadmin');
    await MasterItemModel.create({ type: 'unit', code: 'PCT', name: '%' });
    const file = await xlsx([
      {
        Code: 'SOC',
        Name: 'Soil organic carbon',
        'Unit code': 'PCT',
        Category: 'Soil chemical',
        Min: '0',
        Max: '15',
      },
      {
        Code: 'TEXTURE',
        Name: 'Soil texture',
        Category: 'Soil physical',
        'Data type': 'choice',
        Choices: 'Sandy | Loam | Clay',
      },
      { Code: 'BAD', Name: 'Bad unit', 'Unit code': 'NOPE', Category: 'Other' },
    ]);
    const preview = await agent.post('/api/v1/parameters/import').attach('file', file, 'p.xlsx').expect(200);
    expect(preview.body.data.errors).toEqual([expect.objectContaining({ row: 4, field: 'unitCode' })]);

    const good = await xlsx([
      {
        Code: 'SOC',
        Name: 'Soil organic carbon',
        'Unit code': 'PCT',
        Category: 'Soil chemical',
        Min: '0',
        Max: '15',
      },
      {
        Code: 'TEXTURE',
        Name: 'Soil texture',
        Category: 'Soil physical',
        'Data type': 'choice',
        Choices: 'Sandy | Loam | Clay',
      },
    ]);
    await agent.post('/api/v1/parameters/import?dryRun=false').attach('file', good, 'p.xlsx').expect(200);
    const list = await agent.get('/api/v1/parameters?category=Soil%20physical').expect(200);
    expect(list.body.data[0]).toMatchObject({ code: 'TEXTURE', choices: ['Sandy', 'Loam', 'Clay'] });
  });
});

describe('partial updates keep fields that were not sent', () => {
  it('editing a centre name keeps its type; editing a parameter keeps its data type', async () => {
    const { agent } = await signedInAgent('superadmin');
    const centre = await agent
      .post('/api/v1/centres')
      .send({
        code: 'VOL',
        name: 'Voluntary',
        host: 'Some University',
        state: 'Kerala',
        type: 'Voluntary Centre',
      })
      .expect(201);
    const edited = await agent
      .patch(`/api/v1/centres/${centre.body.data.id}`)
      .send({ name: 'Renamed' })
      .expect(200);
    expect(edited.body.data.type).toBe('Voluntary Centre');

    const p = await agent
      .post('/api/v1/parameters')
      .send({
        code: 'TEXTURE',
        name: 'Texture',
        category: 'Soil physical',
        dataType: 'choice',
        choices: ['Sandy', 'Clay'],
      })
      .expect(201);
    const renamed = await agent
      .patch(`/api/v1/parameters/${p.body.data.id}`)
      .send({ name: 'Soil texture' })
      .expect(200);
    expect(renamed.body.data).toMatchObject({ dataType: 'choice', choices: ['Sandy', 'Clay'] });
  });
});

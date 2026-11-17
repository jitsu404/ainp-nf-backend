import { z } from 'zod';
import type { RequestSchemas } from '../../middlewares/validate.js';
import { idParams, importQuery, objectId } from '../../utils/validators.js';
import { fyCode } from '../financialYears/financialYears.dto.js';
import { masterCode } from '../masters/masters.dto.js';
import { SHEET_STATUSES } from './sheets.model.js';

const createBody = z
  .object({
    trialId: objectId,
    fyCode,
    seasonCode: masterCode.meta({ example: 'KHARIF' }),
    croppingSystemCode: masterCode.nullable().optional().meta({ example: 'CS1' }),
    cropCode: masterCode.nullable().optional().meta({ example: 'RICE' }),
  })
  .strict();

const cellValue = z.union([z.number(), z.string().max(2000), z.null()]);

const valuesBody = z
  .object({
    values: z
      .array(
        z
          .object({
            treatmentCode: masterCode.meta({ example: 'T1' }),
            replication: z.number().int().min(1).max(20).nullable().default(null),
            parameterId: objectId,
            value: cellValue.meta({ description: 'null clears the cell' }),
          })
          .strict(),
      )
      .min(1)
      .max(10000),
  })
  .strict();

const remarkBody = z.object({ remark: z.string().trim().max(2000).optional() }).strict();
const returnBody = z
  .object({ remark: z.string().trim().min(3).max(2000).meta({ example: 'Recheck yield of T3 R2' }) })
  .strict();

const listQuery = z.object({
  trialId: objectId.optional(),
  experimentId: objectId.optional(),
  centreId: objectId.optional(),
  fyCode: fyCode.optional(),
  seasonCode: masterCode.optional(),
  status: z.enum(SHEET_STATUSES).optional(),
});

const summaryQuery = z.object({
  experimentId: objectId,
  fyCode,
  seasonCode: masterCode.optional(),
  includeUnapproved: z.stringbool().default(false).meta({ description: 'Include sheets not yet approved' }),
});

export const listSheetsSchemas = { query: listQuery } satisfies RequestSchemas;
export const getSheetSchemas = { params: idParams } satisfies RequestSchemas;
export const createSheetSchemas = { body: createBody } satisfies RequestSchemas;
export const saveValuesSchemas = { params: idParams, body: valuesBody } satisfies RequestSchemas;
export const submitSheetSchemas = { params: idParams, body: remarkBody } satisfies RequestSchemas;
export const returnSheetSchemas = { params: idParams, body: returnBody } satisfies RequestSchemas;
export const approveSheetSchemas = { params: idParams, body: remarkBody } satisfies RequestSchemas;
export const sheetTemplateSchemas = { params: idParams } satisfies RequestSchemas;
export const importSheetSchemas = { params: idParams, query: importQuery } satisfies RequestSchemas;
export const sheetAnalysisSchemas = { params: idParams } satisfies RequestSchemas;
export const summarySchemas = { query: summaryQuery } satisfies RequestSchemas;
export const reportingSchemas = {
  query: z.object({ experimentId: objectId }),
} satisfies RequestSchemas;

export type CreateSheetDto = z.output<typeof createBody>;
export type SaveValuesDto = z.output<typeof valuesBody>;
export type ListSheetsQuery = z.output<typeof listQuery>;
export type SummaryQuery = z.output<typeof summaryQuery>;
export type CellInput = SaveValuesDto['values'][number];

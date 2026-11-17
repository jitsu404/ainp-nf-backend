import type { Request, Response } from 'express';
import { getValidated } from '../../middlewares/validate.js';
import { uploadedBuffer } from '../../middlewares/upload.js';
import { contextOf } from '../../utils/context.js';
import { XLSX_CONTENT_TYPE, created, ok, sendFile } from '../../utils/response.js';
import type {
  approveSheetSchemas,
  createSheetSchemas,
  getSheetSchemas,
  importSheetSchemas,
  listSheetsSchemas,
  returnSheetSchemas,
  saveValuesSchemas,
  sheetAnalysisSchemas,
  sheetTemplateSchemas,
  submitSheetSchemas,
  summarySchemas,
  reportingSchemas,
  trendSchemas,
} from './sheets.dto.js';
import * as sheetsReports from './sheets.reports.js';
import * as sheetsService from './sheets.service.js';

export const list = async (req: Request, res: Response) => {
  const { query } = getValidated<typeof listSheetsSchemas>(req);
  ok(res, await sheetsService.listSheets(contextOf(req), query));
};

export const getById = async (req: Request, res: Response) => {
  const { params } = getValidated<typeof getSheetSchemas>(req);
  ok(res, await sheetsService.getSheetDetail(contextOf(req), params.id));
};

export const create = async (req: Request, res: Response) => {
  const { body } = getValidated<typeof createSheetSchemas>(req);
  const ctx = contextOf(req);
  const sheet = await sheetsService.createSheet(ctx, body);
  created(res, await sheetsService.getSheetDetail(ctx, sheet.id as string));
};

export const saveValues = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof saveValuesSchemas>(req);
  ok(res, await sheetsService.saveValues(contextOf(req), params.id, body.values));
};

export const submit = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof submitSheetSchemas>(req);
  ok(res, await sheetsService.submitSheet(contextOf(req), params.id, body.remark));
};

export const returnSheet = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof returnSheetSchemas>(req);
  ok(res, await sheetsService.returnSheet(contextOf(req), params.id, body.remark));
};

export const approve = async (req: Request, res: Response) => {
  const { params, body } = getValidated<typeof approveSheetSchemas>(req);
  ok(res, await sheetsService.approveSheet(contextOf(req), params.id, body.remark));
};

export const template = async (req: Request, res: Response) => {
  const { params } = getValidated<typeof sheetTemplateSchemas>(req);
  const { buffer, filename } = await sheetsService.sheetTemplate(contextOf(req), params.id);
  sendFile(res, buffer, filename, XLSX_CONTENT_TYPE);
};

export const importFile = async (req: Request, res: Response) => {
  const { params, query } = getValidated<typeof importSheetSchemas>(req);
  ok(res, await sheetsService.importSheet(contextOf(req), params.id, uploadedBuffer(req), query.dryRun));
};

export const analysis = async (req: Request, res: Response) => {
  const { params } = getValidated<typeof sheetAnalysisSchemas>(req);
  ok(res, await sheetsService.analyseSheet(contextOf(req), params.id));
};

export const reporting = async (req: Request, res: Response) => {
  const { query } = getValidated<typeof reportingSchemas>(req);
  ok(res, await sheetsService.reportingStatus(contextOf(req), query.experimentId));
};

export const summary = async (req: Request, res: Response) => {
  const { query } = getValidated<typeof summarySchemas>(req);
  ok(res, await sheetsService.experimentSummary(contextOf(req), query));
};

export const trend = async (req: Request, res: Response) => {
  const { query } = getValidated<typeof trendSchemas>(req);
  ok(res, await sheetsReports.experimentTrend(contextOf(req), query));
};

export const summaryExport = async (req: Request, res: Response) => {
  const { query } = getValidated<typeof summarySchemas>(req);
  const { buffer, filename } = await sheetsReports.exportSummary(contextOf(req), query);
  sendFile(res, buffer, filename, XLSX_CONTENT_TYPE);
};

export const analysisExport = async (req: Request, res: Response) => {
  const { params } = getValidated<typeof sheetAnalysisSchemas>(req);
  const { buffer, filename } = await sheetsReports.exportSheetAnalysis(contextOf(req), params.id);
  sendFile(res, buffer, filename, XLSX_CONTENT_TYPE);
};

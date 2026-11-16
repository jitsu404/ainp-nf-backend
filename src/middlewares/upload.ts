import type { Request, RequestHandler } from 'express';
import multer from 'multer';
import { tagHandler } from '../docs/routeMeta.js';
import { AppError } from '../utils/AppError.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const excelUpload = multer({
  storage: multer.memoryStorage(), // imports are parsed and discarded; nothing is written to disk
  limits: { fileSize: MAX_IMPORT_BYTES, files: 1 },
  fileFilter: (_req, file, done) => {
    const ok = file.originalname.toLowerCase().endsWith('.xlsx') || file.mimetype === XLSX_MIME;
    if (ok) done(null, true);
    else done(AppError.badRequest('INVALID_FILE', 'Upload an Excel .xlsx file'));
  },
}).single('file');

/** Accepts one .xlsx in the multipart field "file" (max 5 MB) into req.file. */
export const uploadExcel: RequestHandler = tagHandler<RequestHandler>(
  (req, res, next) => {
    excelUpload(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        return next(
          err.code === 'LIMIT_FILE_SIZE'
            ? AppError.badRequest('FILE_TOO_LARGE', 'The file is larger than 5 MB')
            : AppError.badRequest('INVALID_UPLOAD', err.message),
        );
      }
      if (err) return next(err);
      if (!req.file)
        return next(AppError.badRequest('FILE_REQUIRED', 'Attach the .xlsx file in the "file" field'));
      next();
    });
  },
  { doc: { description: 'Multipart upload: send the .xlsx in the form field **file** (max 5 MB).' } },
);

export const uploadedBuffer = (req: Request): Buffer => {
  if (!req.file) throw AppError.badRequest('FILE_REQUIRED', 'Attach the .xlsx file in the "file" field');
  return req.file.buffer;
};

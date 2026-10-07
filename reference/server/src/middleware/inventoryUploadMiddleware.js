import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadDirectory = path.resolve(__dirname, '../../uploads/inventory');
const allowedExtensions = new Set(['.xlsx', '.xls', '.csv']);

function ensureUploadDirectory() {
  fs.mkdirSync(uploadDirectory, { recursive: true });
}

function sanitizeFileName(fileName) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

const storage = multer.diskStorage({
  destination(_req, _file, callback) {
    ensureUploadDirectory();
    callback(null, uploadDirectory);
  },
  filename(_req, file, callback) {
    const extension = path.extname(file.originalname || '').toLowerCase();
    const baseName = path.basename(file.originalname || 'inventory-upload', extension);
    const safeBaseName = sanitizeFileName(baseName);
    const generatedName = `${Date.now()}-${safeBaseName}${extension}`;
    callback(null, generatedName);
  },
});

function fileFilter(_req, file, callback) {
  const extension = path.extname(file.originalname || '').toLowerCase();

  if (!allowedExtensions.has(extension)) {
    const error = new Error('Only .xlsx, .xls, and .csv files are allowed.');
    error.statusCode = 400;
    callback(error);
    return;
  }

  callback(null, true);
}

export const inventoryUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 1,
  },
});

export function getInventoryUploadDirectory() {
  ensureUploadDirectory();
  return uploadDirectory;
}

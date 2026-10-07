import { getInventoryUploadDirectory } from '../middleware/inventoryUploadMiddleware.js';

export async function saveInventoryUpload({ file, botUserId }) {
  if (!file) {
    const error = new Error('Inventory file is required.');
    error.statusCode = 400;
    throw error;
  }

  const uploadDirectory = getInventoryUploadDirectory();

  return {
    storedFileName: file.filename,
    uploadDirectory,
    fileSizeBytes: file.size,
    mimeType: file.mimetype || null,
    uploadedBy: botUserId,
    uploadedAt: new Date().toISOString(),
  };
}

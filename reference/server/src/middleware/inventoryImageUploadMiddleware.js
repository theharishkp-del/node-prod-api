import multer from 'multer';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

function fileFilter(_req, file, callback) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    const error = new Error('Only JPEG, PNG, WebP, or GIF images are allowed.');
    error.statusCode = 400;
    callback(error);
    return;
  }
  callback(null, true);
}

// Store in memory so we can pipe the buffer directly to S3 — no disk write needed.
export const inventoryImageUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize: MAX_SIZE_BYTES,
    files: 1,
  },
});

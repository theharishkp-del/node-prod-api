import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function ensureS3Config() {
  const bucket = normalizeText(env.awsS3Bucket);
  const region = normalizeText(env.awsRegion);
  const accessKeyId = normalizeText(env.awsAccessKeyId);
  const secretAccessKey = normalizeText(env.awsSecretAccessKey);

  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    throw new Error('AWS S3 configuration is incomplete.');
  }

  return {
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    prefix: normalizeText(env.awsS3Prefix),
  };
}

function sanitizePathSegment(value, fallback = 'document') {
  const normalized = normalizeText(value);
  const sanitized = normalized.replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_').replace(/\s+/g, '_');
  return sanitized || fallback;
}

function buildObjectKey(prefix, folderName, fileName) {
  return [prefix, folderName, fileName].filter(Boolean).join('/');
}

function resolveStorageFolder() {
  const configuredFolder = normalizeText(env.s3StorageFolder);
  if (configuredFolder) {
    return configuredFolder;
  }

  const databaseName = normalizeText(env.botDbName).toUpperCase();
  const configuredFolders = {
    HM_5: 'afte',
    HM_6: 'cybot',
  };

  return configuredFolders[databaseName] || normalizeText(env.s3StorageFolder);
}

let s3Client;

function getS3Client() {
  if (s3Client) {
    return s3Client;
  }

  const config = ensureS3Config();
  s3Client = new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return s3Client;
}

export async function uploadBufferToS3({
  body,
  fileName,
  folderName,
  contentType = 'application/octet-stream',
  contentDisposition = '',
  mimeType = 'document',
}) {
  const config = ensureS3Config();
  const resolvedFolderName = sanitizePathSegment(folderName, 'documents');
  const resolvedFileName = sanitizePathSegment(fileName, 'document');
  const logicalKey = buildObjectKey(config.prefix, resolvedFolderName, resolvedFileName);
  const storageFolder = sanitizePathSegment(resolveStorageFolder(), '');
  const key = buildObjectKey(storageFolder, logicalKey, '');

  await getS3Client().send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    ...(normalizeText(contentDisposition) ? { ContentDisposition: contentDisposition } : {}),
  }));

  const url = `https://${config.bucket}.s3.${config.region}.amazonaws.com/${key}`;
  const uploadedAt = new Date();

  logger.info('Uploaded document to S3', {
    bucket: config.bucket,
    region: config.region,
    key,
    contentType,
    contentDisposition: normalizeText(contentDisposition) || null,
    mimeType,
  });

  return {
    bucket: config.bucket,
    region: config.region,
    folderName: resolvedFolderName,
    fileName: resolvedFileName,
    fileNameFolder: logicalKey,
    mimeType,
    contentType,
    key,
    url,
    uploadedAt,
  };
}

export async function deleteObjectFromS3({ key, bucket = '' }) {
  const resolvedKey = normalizeText(key);

  if (!resolvedKey) {
    return false;
  }

  const config = ensureS3Config();
  const resolvedBucket = normalizeText(bucket) || config.bucket;

  await getS3Client().send(new DeleteObjectCommand({
    Bucket: resolvedBucket,
    Key: resolvedKey,
  }));

  logger.info('Deleted document from S3', {
    bucket: resolvedBucket,
    key: resolvedKey,
  });

  return true;
}

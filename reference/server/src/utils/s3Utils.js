import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { postJson } from './httpClient.js';

const DEFAULT_S3_RETRY_ATTEMPTS = 3;

function normalizeText(value) {
  return String(value || '').trim();
}

function buildAxiosErrorDetails(error) {
  return {
    message: error?.message || 'Unknown error',
    code: error?.code || null,
    status: error?.response?.status || null,
    statusText: error?.response?.statusText || null,
    responseData: error?.response?.data || null,
  };
}

async function retryRequest(requestFactory, attempts = DEFAULT_S3_RETRY_ATTEMPTS) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await requestFactory();
    } catch (error) {
      lastError = error;
      logger.warn('S3 URL request attempt failed', {
        attempt,
        attempts,
        error: buildAxiosErrorDetails(error),
      });
    }
  }

  throw lastError;
}

export async function getS3Url(databaseName, folderId, fileName, fileType) {
  const resolvedDatabaseName = normalizeText(databaseName);
  const resolvedFolderId = normalizeText(folderId);
  const resolvedFileName = normalizeText(fileName);
  const resolvedFileType = normalizeText(fileType);

  if (!env.s3ApiUrl) {
    throw new Error('S3_API_URL is not configured.');
  }

  logger.info('Requesting S3 URL', {
    s3ApiUrl: env.s3ApiUrl,
    databaseName: resolvedDatabaseName,
    folderId: resolvedFolderId,
    fileName: resolvedFileName,
    fileType: resolvedFileType,
  });

  try {
    const result = await retryRequest(async () => {
      try {
        const responseData = await postJson(
          env.s3ApiUrl,
          {
            databaseName: resolvedDatabaseName,
            folderId: resolvedFolderId,
            fileName: resolvedFileName,
            fileType: resolvedFileType,
          },
          {
            label: 'S3 URL request',
          },
        );

        if (responseData?.url) {
          return responseData;
        }

        logger.warn('S3 URL service returned invalid payload', {
          s3ApiUrl: env.s3ApiUrl,
          databaseName: resolvedDatabaseName,
          folderId: resolvedFolderId,
          fileName: resolvedFileName,
          fileType: resolvedFileType,
          responseData: responseData ?? null,
        });

        throw new Error('Invalid response from S3 service.');
      } catch (error) {
        logger.warn('S3 URL request HTTP error details', {
          s3ApiUrl: env.s3ApiUrl,
          databaseName: resolvedDatabaseName,
          folderId: resolvedFolderId,
          fileName: resolvedFileName,
          fileType: resolvedFileType,
          error: buildAxiosErrorDetails(error),
        });
        throw error;
      }
    });

    logger.info('Received S3 URL successfully', {
      url: result.url,
      thumbUrl: result.thumbUrl || result.thumpUrl || null,
    });

    return result;
  } catch (error) {
    logger.error('Failed to fetch S3 URL', {
      s3ApiUrl: env.s3ApiUrl,
      error: buildAxiosErrorDetails(error),
      databaseName: resolvedDatabaseName,
      folderId: resolvedFolderId,
      fileName: resolvedFileName,
      fileType: resolvedFileType,
    });
    throw new Error('Failed to fetch S3 URL.');
  }
}

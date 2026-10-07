import { buildStandardEOResponse } from '../../../utils/eoResponse/buildStandardEOResponse.js';
import { normalizeText, resolveResponseFromId } from './standardEOShared.js';

function splitFileNameFolderFromUrl(fileUrl = '') {
  const normalizedUrl = normalizeText(fileUrl);

  if (!normalizedUrl) {
    return {
      fileName: '',
      folderPath: '',
    };
  }

  try {
    const { pathname = '' } = new URL(normalizedUrl);
    const normalizedPath = pathname.replace(/^\/+/, '');
    const pathSegments = normalizedPath.split('/').filter(Boolean);

    if (pathSegments.length === 0) {
      return {
        fileName: '',
        folderPath: '',
      };
    }

    return {
      fileName: pathSegments[pathSegments.length - 1] || '',
      folderPath: pathSegments.slice(0, -1).join('/'),
    };
  } catch {
    return {
      fileName: '',
      folderPath: '',
    };
  }
}

function resolveQrCodeResponseMetadata(imageUrl = '') {
  const { fileName } = splitFileNameFolderFromUrl(imageUrl);
  return {
    description: fileName,
    fileName,
    fileNameFolder: fileName,
  };
}

export async function handleStandardEOAdminMenuBotQrCode(req) {
  const reqMessageObj = req.body?.reqMessageObj ?? {};
  const botUserId = req.body?.botUserId ?? '';
  const qrCodeUrl = normalizeText(req.tenant?.botDetails?.aiMeetQrCodeURL);
  const qrCodeMetadata = resolveQrCodeResponseMetadata(qrCodeUrl);

  return buildStandardEOResponse({
    resultCode: qrCodeMetadata.fileName ? '0' : '1',
    resultText: qrCodeMetadata.fileName ? 'success' : 'failure',
    reqMessageObj,
    eoState: 'stop',
    resMessageObj: {
      taskId: reqMessageObj.taskId ?? '',
      fromId: resolveResponseFromId(reqMessageObj, botUserId),
      mimeType: 'image',
    },
    description: qrCodeMetadata.description,
    fileName: qrCodeMetadata.fileName || qrCodeUrl || 'QR code image is not available.',
    fileNameFolder: qrCodeMetadata.fileNameFolder,
  });
}

import { buildStandardEOResponse } from '../standardEO.js';

export function buildEoResposne({
  resultCode,
  resultText,
  reqMessageObj = {},
  resMessageObj = {},
  eoState = 'stop',
  fileName = '',
  fileNameFolder = '',
  description = '',
  thumbFileNameFolder = '',
  thumpNailName = '',
}) {
  return buildStandardEOResponse({
    resultCode,
    resultText,
    reqMessageObj,
    resMessageObj,
    eoState,
    fileName,
    fileNameFolder,
    description,
    thumbFileNameFolder,
    thumpNailName,
  });
}

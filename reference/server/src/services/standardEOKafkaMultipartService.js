import { logger } from '../config/logger.js';
import { sendKafkaMessage } from './kafkaMessageService.js';
import {
  decodeBase64Value,
  encodeBase64Value,
  generateSignalId,
} from '../utils/standardEO.js';

const MAX_INLINE_TEXT_CHARS = 4999;
const MAX_KAFKA_BASE64_CHARS = 4999;

function normalizeText(value) {
  return String(value || '').trim();
}

function isTextMimeType(mimeType) {
  const normalizedMimeType = normalizeText(mimeType).toLowerCase();

  return (
    normalizedMimeType === 'text' ||
    normalizedMimeType === 'plain' ||
    normalizedMimeType.startsWith('text/')
  );
}

function buildChunkText(chunkText, index, totalChunks) {
  return `AGENT RESPONSE (${index + 1}/${totalChunks})\n${chunkText}`;
}

function buildWorstCaseChunkText(chunkText, chunkDigits) {
  const maxChunkNumber = '9'.repeat(Math.max(1, chunkDigits));
  return `AGENT RESPONSE (${maxChunkNumber}/${maxChunkNumber})\n${chunkText}`;
}

function splitTextByBase64Limit(text, maxBase64Chars) {
  const characters = Array.from(String(text || ''));

  if (characters.length === 0) {
    return [];
  }

  let assumedChunkDigits = 1;

  while (true) {
    const parts = [];
    let index = 0;

    while (index < characters.length) {
      let currentPart = '';

      while (index < characters.length) {
        const candidate = `${currentPart}${characters[index]}`;
        const encodedCandidateLength = encodeBase64Value(
          buildWorstCaseChunkText(candidate, assumedChunkDigits),
        ).length;

        if (encodedCandidateLength > maxBase64Chars) {
          break;
        }

        currentPart = candidate;
        index += 1;
      }

      if (!currentPart) {
        throw new Error('Unable to split Standard EO response within Kafka base64 limit.');
      }

      parts.push(currentPart);
    }

    const actualChunkDigits = String(parts.length).length;

    if (actualChunkDigits === assumedChunkDigits) {
      return parts;
    }

    assumedChunkDigits = actualChunkDigits;
  }
}

function buildKafkaPayload({
  reqMessageObj = {},
  responseMessage = {},
  botUserId = '',
  encodedChunk = '',
}) {
  return {
    taskId: responseMessage.taskId ?? reqMessageObj.taskId ?? '',
    fromId: normalizeText(botUserId),
    targetLanguage: 'en',
    parentId: generateSignalId(),
    signalId: generateSignalId(),
    mimeType: 'text',
    databaseName: responseMessage.databaseName ?? reqMessageObj.databaseName ?? '',
    requestType: reqMessageObj.requestType ?? 'taskConversation',
    fileName: encodedChunk,
  };
}

function shouldUseKafkaMultipart(response = {}) {
  const mimeType = response?.resMessageObj?.mimeType;

  if (!isTextMimeType(mimeType)) {
    return false;
  }

  const encodedFileName = String(response?.resMessageObj?.fileName || '');
  const decodedFileName = decodeBase64Value(encodedFileName);

  return (
    decodedFileName.length > MAX_INLINE_TEXT_CHARS ||
    encodedFileName.length > MAX_KAFKA_BASE64_CHARS
  );
}

export async function sendOversizedStandardEOResponseViaKafka({
  requestId = '',
  reqMessageObj = {},
  response = {},
  botUserId = '',
  kafkaUrl,
} = {}) {
  if (!shouldUseKafkaMultipart(response)) {
    return response;
  }

  const responseMessage = response?.resMessageObj ?? {};
  const encodedFileName = String(responseMessage.fileName || '');
  const decodedFileName = decodeBase64Value(encodedFileName);
  const rawChunks = splitTextByBase64Limit(decodedFileName, MAX_KAFKA_BASE64_CHARS);
  const totalChunks = rawChunks.length;

  logger.info('Standard EO Kafka multipart delivery started', {
    requestId,
    parentSignalId: reqMessageObj.signalId ?? null,
    responseSignalId: responseMessage.signalId ?? null,
    totalChunks,
    originalTextLength: decodedFileName.length,
    originalBase64Length: encodedFileName.length,
  });

  for (const [index, chunk] of rawChunks.entries()) {
    const chunkText = buildChunkText(chunk, index, totalChunks);
    const encodedChunk = encodeBase64Value(chunkText);

    if (encodedChunk.length > MAX_KAFKA_BASE64_CHARS) {
      throw new Error(
        `Kafka multipart chunk exceeded base64 limit at part ${index + 1}/${totalChunks}.`,
      );
    }

    await sendKafkaMessage({
      requestId,
      kafkaUrl,
      payload: buildKafkaPayload({
        reqMessageObj,
        responseMessage,
        botUserId,
        encodedChunk,
      }),
    });
  }

  logger.info('Standard EO Kafka multipart delivery completed', {
    requestId,
    parentSignalId: reqMessageObj.signalId ?? null,
    responseSignalId: responseMessage.signalId ?? null,
    totalChunks,
  });

  return {
    ...response,
    resMessageObj: {
      ...responseMessage,
      fileName: '',
    },
  };
}

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { postJson } from '../utils/httpClient.js';
import { encodeBase64Value, generateSignalId } from '../utils/standardEO.js';

const MAX_KAFKA_BASE64_CHARS = 4999;

function normalizeText(value) {
  return String(value || '').trim();
}

function resolveKafkaResult(data = {}) {
  const resultCode = data?.resultCode ?? data?.result_code ?? data?.result_Code;
  const resultText = data?.resultText ?? data?.result_text ?? data?.result_Text ?? '';

  return {
    resultCode: normalizeText(resultCode),
    resultText: normalizeText(resultText),
  };
}

function buildChunkText(chunkText, index, totalChunks, chunkLabel) {
  return `${chunkLabel} (${index + 1}/${totalChunks})\n${chunkText}`;
}

function buildWorstCaseChunkText(chunkText, chunkDigits, chunkLabel) {
  const maxChunkNumber = '9'.repeat(Math.max(1, chunkDigits));
  return `${chunkLabel} (${maxChunkNumber}/${maxChunkNumber})\n${chunkText}`;
}

function splitTextByBase64Limit(text, maxBase64Chars, chunkLabel) {
  const characters = Array.from(String(text || ''));

  if (!characters.length) {
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
        const encodedLength = encodeBase64Value(
          buildWorstCaseChunkText(candidate, assumedChunkDigits, chunkLabel),
        ).length;

        if (encodedLength > maxBase64Chars) {
          break;
        }

        currentPart = candidate;
        index += 1;
      }

      if (!currentPart) {
        throw new Error('Unable to split Kafka text within the Base64 size limit.');
      }

      parts.push(currentPart);
    }

    if (String(parts.length).length === assumedChunkDigits) {
      return parts;
    }

    assumedChunkDigits = String(parts.length).length;
  }
}

export async function sendKafkaMessage({
  kafkaUrl = env.kafkaMsgUrlWs,
  payload = {},
  headers = {},
  requestId = '',
} = {}) {
  const resolvedKafkaUrl = normalizeText(kafkaUrl);

  if (!resolvedKafkaUrl) {
    logger.error('Kafka message request skipped because URL is missing', {
      requestId,
      payload,
    });

    throw new Error('Kafka message URL is not configured.');
  }

  logger.info('Kafka message request started', {
    requestId,
    kafkaUrl: resolvedKafkaUrl,
    payload,
  });

  try {
    const data = await postJson(resolvedKafkaUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      requestId,
      label: 'Kafka message request',
    });

    const { resultCode, resultText } = resolveKafkaResult(data);
    const success = resultCode === '0';

    logger.info(
      success
        ? 'Kafka message request succeeded'
        : 'Kafka message request returned negative response',
      {
        requestId,
        kafkaUrl: resolvedKafkaUrl,
        resultCode,
        resultText,
        responseBody: data,
      },
    );

    return {
      success,
      message: resultText,
      resultCode,
      data,
    };
  } catch (error) {
    logger.error('Kafka message request failed', {
      requestId,
      kafkaUrl: resolvedKafkaUrl,
      error: error?.message,
      responseBody: error?.response?.data,
    });

    throw new Error(`Failed to send Kafka message: ${error?.message || 'Unknown error'}`);
  }
}

export async function sendKafkaTextMessage({
  taskId = '',
  fromId = '',
  databaseName = '',
  message = '',
  requestType = 'taskConversation',
  targetLanguage = 'en',
  requestId = '',
  kafkaUrl = env.kafkaMsgUrlWs,
  chunkLabel = 'MESSAGE',
} = {}) {
  const normalizedMessage = String(message || '');
  const encodedMessage = encodeBase64Value(normalizedMessage);
  const buildPayload = (encodedText) => ({
    taskId: normalizeText(taskId),
    fromId: normalizeText(fromId),
    targetLanguage,
    parentId: generateSignalId(),
    signalId: generateSignalId(),
    mimeType: 'text',
    databaseName: normalizeText(databaseName),
    requestType,
    fileName: encodedText,
  });

  if (encodedMessage.length <= MAX_KAFKA_BASE64_CHARS) {
    return sendKafkaMessage({
      requestId,
      kafkaUrl,
      payload: buildPayload(encodedMessage),
    });
  }

  const chunks = splitTextByBase64Limit(normalizedMessage, MAX_KAFKA_BASE64_CHARS, chunkLabel);
  logger.info('Kafka text message split into parts', {
    requestId,
    taskId: normalizeText(taskId),
    totalChunks: chunks.length,
    originalBase64Length: encodedMessage.length,
  });

  const results = [];
  for (const [index, chunk] of chunks.entries()) {
    const encodedChunk = encodeBase64Value(buildChunkText(chunk, index, chunks.length, chunkLabel));
    results.push(await sendKafkaMessage({
      requestId,
      kafkaUrl,
      payload: buildPayload(encodedChunk),
    }));
  }

  const success = results.every((result) => result.success);
  const lastResult = results.at(-1) || {};
  return {
    success,
    resultCode: lastResult.resultCode || '',
    message: success ? 'Kafka text message sent successfully.' : 'One or more Kafka text message parts failed.',
    data: results.map((result) => result.data),
    totalChunks: chunks.length,
  };
}

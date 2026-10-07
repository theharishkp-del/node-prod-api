import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const logDir = process.env.LOG_DIR || path.join(projectRoot, 'logs');
const parsedLogBufferLimit = Number.parseInt(process.env.LOG_BUFFER_LIMIT || '500', 10);
const logBufferLimit = Number.isNaN(parsedLogBufferLimit) || parsedLogBufferLimit < 1 ? 500 : parsedLogBufferLimit;
const recentLogs = [];
const REDACTED_VALUES = new Set(['password', 'pass', 'secret', 'token', 'authorization', 'cookie', 'set-cookie', 'x-api-key', 'apiKey', 'accessToken', 'refreshToken', 'clientSecret', 'privateKey']);

fs.mkdirSync(logDir, { recursive: true });

function redactSensitiveValue(key, value) {
  if (typeof key !== 'string') {
    return value;
  }

  const normalizedKey = key.toLowerCase();
  if (REDACTED_VALUES.has(normalizedKey) || normalizedKey.includes('secret') || normalizedKey.includes('token') || normalizedKey.includes('password') || normalizedKey.includes('cookie') || normalizedKey.includes('authorization')) {
    return '[REDACTED]';
  }

  return value;
}

function sanitizeLogValue(value, depth = 0, parentKey = '') {
  if (value == null) {
    return value ?? null;
  }

  if (depth >= 5) {
    return '[Max depth reached]';
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return `[Buffer ${value.length} bytes]`;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeLogValue(item, depth + 1, `${parentKey}[${index}]`));
  }

  if (typeof value === 'object') {
    if (value?._bsontype === 'ObjectId' && typeof value.toString === 'function') {
      return value.toString();
    }

    return Object.entries(value).reduce((result, [key, entryValue]) => {
      const safeKey = key;
      const safeValue = sanitizeLogValue(redactSensitiveValue(safeKey, entryValue), depth + 1, safeKey);
      result[safeKey] = safeValue;
      return result;
    }, {});
  }

  return redactSensitiveValue(parentKey, value);
}

function pushRecentLog(entry) {
  recentLogs.push(entry);

  if (recentLogs.length > logBufferLimit) {
    recentLogs.splice(0, recentLogs.length - logBufferLimit);
  }
}

function getCallerInfo() {
  const stackHolder = {};
  Error.captureStackTrace(stackHolder, getCallerInfo);

  const frames = (stackHolder.stack || '')
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean);

  const callerFrame = frames.find((line) => {
    if (!line.startsWith('at ')) return false;
    if (line.includes('node:internal') || line.includes('internal/') || line.includes('logger.js')) {
      return false;
    }
    return true;
  }) || frames[0] || 'at unknown';

  let functionName = 'anonymous';
  let fileName = 'unknown';

  const functionMatch = callerFrame.match(/at\s+([^(]+?)\s+\((.+):\d+:\d+\)/) || callerFrame.match(/at\s+([^(]+?)\s+(.+):\d+:\d+/);
  if (functionMatch) {
    functionName = functionMatch[1].replace(/^Object\./, '').replace(/^null\./, '').replace(/^global\./, '');
    fileName = functionMatch[2];
  } else {
    const simpleMatch = callerFrame.match(/at\s+(.+):\d+:\d+/);
    if (simpleMatch) {
      fileName = simpleMatch[1];
    }
  }

  if (fileName.startsWith('file://')) {
    fileName = fileURLToPath(fileName);
  }

  if (fileName && !path.isAbsolute(fileName)) {
    fileName = path.resolve(fileName);
  }

  if (path.isAbsolute(fileName)) {
    fileName = path.relative(projectRoot, fileName) || path.basename(fileName);
  }

  return { functionName, fileName };
}

function withCallerInfo(meta = {}) {
  const { functionName, fileName } = getCallerInfo();

  return {
    ...meta,
    filename: fileName,
    functionName,
  };
}

export function buildDefaultLogFields(meta = {}) {
  const safeMeta = sanitizeLogValue(meta || {});
  const baseFields = {
    timestamp: safeMeta.timestamp || new Date().toISOString(),
    service: safeMeta.service || 'fsm-agent',
    requestId: safeMeta.requestId,
    tenantId: safeMeta.tenantId,
    botUserId: safeMeta.botUserId,
    sessionId: safeMeta.sessionId,
    method: safeMeta.method,
    url: safeMeta.url,
    route: safeMeta.route,
    statusCode: safeMeta.statusCode,
    durationMs: safeMeta.durationMs,
    ip: safeMeta.ip,
    userAgent: safeMeta.userAgent,
    step: safeMeta.step,
    action: safeMeta.action,
    intent: safeMeta.intent,
    routingDecision: safeMeta.routingDecision,
    node: safeMeta.node,
    query: safeMeta.query,
    params: safeMeta.params,
    bodySummary: safeMeta.bodySummary,
    headersSummary: safeMeta.headersSummary,
    payload: safeMeta.payload,
    responseBody: safeMeta.responseBody,
    responsePayload: safeMeta.responsePayload,
    uiContent: safeMeta.uiContent,
    uiContentEscaped: safeMeta.uiContentEscaped,
    outgoingText: safeMeta.outgoingText,
    resMessageObj: safeMeta.resMessageObj,
    errorCode: safeMeta.errorCode,
    errorMessage: safeMeta.errorMessage,
    resultCode: safeMeta.resultCode,
    resultText: safeMeta.resultText,
    stack: safeMeta.stack,
    responseStatus: safeMeta.responseStatus,
  };

  return Object.fromEntries(
    Object.entries(baseFields).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

export function formatLogEntry(info = {}) {
  const { timestamp, level, message, stack, service, ...rest } = info;
  const normalizedLevel = String(level || 'INFO').toUpperCase();
  const lines = [];

  const time = timestamp ? String(timestamp) : new Date().toISOString();
  const summary = message ? String(message) : 'LOG';
  lines.push(`${time} | ${normalizedLevel} | ${summary}`);

  const detailEntries = Object.entries({
    ...buildDefaultLogFields(rest),
    ...(service ? { service } : {}),
  }).filter(([, value]) => value !== undefined && value !== null && value !== '');

  for (const [key, value] of detailEntries) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`  ${key}: ${value}`);
      continue;
    }

    if (value instanceof Error) {
      lines.push(`  ${key}: ${value.name}: ${value.message}`);
      continue;
    }

    if (Array.isArray(value)) {
      const rendered = JSON.stringify(value, null, 2);
      lines.push(`  ${key}: ${rendered.replace(/\n/g, '\n  ')}`);
      continue;
    }

    if (typeof value === 'object') {
      const rendered = JSON.stringify(value, null, 2);
      lines.push(`  ${key}: ${rendered.replace(/\n/g, '\n  ')}`);
      continue;
    }
  }

  if (stack) {
    const stackText = String(stack).replace(/\n/g, '\n  ');
    lines.push(`  stack: ${stackText}`);
  }

  return lines.join('\n');
}

const formatter = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format((info) => {
    info.level = String(info.level || 'info').toUpperCase();
    info.service = 'fsm-agent';
    return info;
  })(),
  winston.format.printf((info) => {
    const { timestamp, level, message, stack, service, ...rest } = info;
    const payload = {
      timestamp,
      level,
      message,
      ...(service ? { service } : {}),
      ...(stack ? { stack } : {}),
      ...rest,
    };

    return JSON.stringify(payload, null, 2);
  })
);

const consoleFormatter = winston.format.printf((info) => formatLogEntry(info));

function createStructuredLogger() {
  const winstonLogger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    defaultMeta: { service: 'fsm-agent' },
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize({ all: true }),
          consoleFormatter
        ),
      }),
      new DailyRotateFile({
        dirname: logDir,
        filename: 'application-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '14d',
        level: process.env.LOG_LEVEL || 'info',
        format: formatter,
      }),
    ],
    exceptionHandlers: [
      new winston.transports.File({
        dirname: logDir,
        filename: 'exceptions.log',
        format: formatter,
      }),
    ],
    exitOnError: false,
  });

  const log = (level, message, meta = {}) => {
    const enrichedMeta = withCallerInfo({
      ...buildDefaultLogFields(meta),
      ...sanitizeLogValue(meta || {}),
    });

    const payload = {
      timestamp: new Date().toISOString(),
      level: String(level || 'info').toUpperCase(),
      message,
      service: 'fsm-agent',
      ...sanitizeLogValue(enrichedMeta),
    };

    pushRecentLog(payload);

    winstonLogger.log(level, message, enrichedMeta);
  };

  return {
    info: (message, meta) => log('info', message, meta),
    warn: (message, meta) => log('warn', message, meta),
    error: (message, meta) => log('error', message, meta),
    debug: (message, meta) => log('debug', message, meta),
    http: (message, meta) => log('http', message, meta),
    flow: (step, meta = {}) => log('info', `FLOW STEP :: ${step}`, { step, flow: true, ...meta }),
    step: (step, meta = {}) => log('info', `STEP :: ${step}`, { step, flow: true, ...meta }),
    log: (level, message, meta) => log(level, message, meta),
    child: (meta) => createStructuredLoggerWithMeta(meta),
  };
}

function createStructuredLoggerWithMeta(meta = {}) {
  const parent = createStructuredLogger();
  return {
    info: (message, extra = {}) => parent.info(message, { ...meta, ...extra }),
    warn: (message, extra = {}) => parent.warn(message, { ...meta, ...extra }),
    error: (message, extra = {}) => parent.error(message, { ...meta, ...extra }),
    debug: (message, extra = {}) => parent.debug(message, { ...meta, ...extra }),
    http: (message, extra = {}) => parent.http(message, { ...meta, ...extra }),
    flow: (step, extra = {}) => parent.flow(step, { ...meta, ...extra }),
    step: (step, extra = {}) => parent.step(step, { ...meta, ...extra }),
    log: (level, message, extra = {}) => parent.log(level, message, { ...meta, ...extra }),
  };
}

export const logger = createStructuredLogger();
export function getLogDirectory() {
  return logDir;
}

export function getLogBufferLimit() {
  return logBufferLimit;
}

export function getRecentLogCount() {
  return recentLogs.length;
}

function getCurrentLogDate() {
  return new Date().toISOString().slice(0, 10);
}

function matchesLogFilters(entry, normalizedLevel, normalizedSearch, normalizedKind = '') {
  if (normalizedLevel && normalizedLevel !== 'ALL' && entry.level !== normalizedLevel) {
    return false;
  }

  const isApiEntry = !!entry.method && !!entry.url;
  if (normalizedKind === 'api' && !isApiEntry) return false;
  if (normalizedKind === 'application' && isApiEntry) return false;

  if (!normalizedSearch) {
    return true;
  }

  return JSON.stringify(entry).toLowerCase().includes(normalizedSearch);
}

function normalizeRequestedLogDate(value) {
  const normalizedDate = String(value || '').trim() || getCurrentLogDate();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
    const error = new Error('Log date must use YYYY-MM-DD format.');
    error.statusCode = 400;
    throw error;
  }

  if (normalizedDate > getCurrentLogDate()) {
    const error = new Error('Log date cannot be in the future.');
    error.statusCode = 400;
    throw error;
  }

  return normalizedDate;
}

function normalizeTimestampValue(value) {
  const rawValue = String(value || '').trim();

  if (!rawValue) {
    return rawValue;
  }

  const isoCandidate = rawValue.includes('T') ? rawValue : rawValue.replace(' ', 'T');
  const parsedValue = new Date(isoCandidate);

  if (Number.isNaN(parsedValue.getTime())) {
    return isoCandidate;
  }

  return parsedValue.toISOString();
}

function normalizeLogEntry(entry = {}) {
  const normalizedEntry = sanitizeLogValue(entry);

  return {
    ...normalizedEntry,
    timestamp: normalizeTimestampValue(normalizedEntry.timestamp),
    level: String(normalizedEntry.level || 'INFO').toUpperCase(),
    message: String(normalizedEntry.message || ''),
  };
}

function readLogFileContentForDate(date) {
  const filePaths = [
    path.join(logDir, `application-${date}.log`),
    path.join(logDir, `application-${date}.log.gz`),
  ];

  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const fileBuffer = fs.readFileSync(filePath);
    const content = filePath.endsWith('.gz')
      ? zlib.gunzipSync(fileBuffer).toString('utf8')
      : fileBuffer.toString('utf8');

    return {
      content,
      source: filePath.endsWith('.gz') ? 'gz-archive' : 'daily-file',
    };
  }

  return {
    content: '',
    source: null,
  };
}

function extractJsonObjects(content = '') {
  const objects = [];
  let depth = 0;
  let objectStart = -1;
  let inString = false;
  let isEscaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (character === '\\') {
        isEscaped = true;
        continue;
      }

      if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === '{') {
      if (depth === 0) {
        objectStart = index;
      }

      depth += 1;
      continue;
    }

    if (character === '}') {
      if (depth === 0) {
        continue;
      }

      depth -= 1;

      if (depth === 0 && objectStart >= 0) {
        objects.push(content.slice(objectStart, index + 1));
        objectStart = -1;
      }
    }
  }

  return objects;
}

function readLogsFromDailyFile(date) {
  const { content, source } = readLogFileContentForDate(date);

  if (!content.trim()) {
    return {
      items: [],
      source: source || 'missing-file',
    };
  }

  const items = extractJsonObjects(content)
    .map((entryText) => {
      try {
        return normalizeLogEntry(JSON.parse(entryText));
      } catch (_error) {
        return null;
      }
    })
    .filter(Boolean);

  return {
    items,
    source: source || 'daily-file',
  };
}

export function getRecentLogs({ limit = 100, level = '', search = '', kind = '' } = {}) {
  const normalizedLevel = String(level || '').trim().toUpperCase();
  const normalizedSearch = String(search || '').trim().toLowerCase();
  const normalizedKind = String(kind || '').trim().toLowerCase();
  const effectiveLimit = Math.max(1, Math.min(Number.parseInt(String(limit || 100), 10) || 100, logBufferLimit));

  return recentLogs
    .filter((entry) => matchesLogFilters(entry, normalizedLevel, normalizedSearch, normalizedKind))
    .slice(-effectiveLimit)
    .reverse();
}

export function getLogsForDate({ date = '', limit = 100, level = '', search = '', kind = '' } = {}) {
  const normalizedDate = normalizeRequestedLogDate(date);
  const normalizedLevel = String(level || '').trim().toUpperCase();
  const normalizedSearch = String(search || '').trim().toLowerCase();
  const normalizedKind = String(kind || '').trim().toLowerCase();
  const effectiveLimit = Math.max(1, Math.min(Number.parseInt(String(limit || 100), 10) || 100, logBufferLimit));
  const fileLogs = readLogsFromDailyFile(normalizedDate);
  const fallbackToBuffer = fileLogs.source === 'missing-file' && normalizedDate === getCurrentLogDate();
  const source = fallbackToBuffer ? 'memory-buffer' : fileLogs.source;
  const matchingEntries = (fallbackToBuffer ? recentLogs : fileLogs.items)
    .filter((entry) => matchesLogFilters(entry, normalizedLevel, normalizedSearch, normalizedKind));
  const items = matchingEntries.slice(-effectiveLimit).reverse();

  return {
    selectedDate: normalizedDate,
    source,
    totalAvailable: matchingEntries.length,
    returnedCount: items.length,
    items,
  };
}

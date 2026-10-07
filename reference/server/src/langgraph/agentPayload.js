import crypto from 'node:crypto';
import { z } from 'zod';

const agentPayloadSchema = z.object({
  customerInfo: z.object({
    name: z.string().trim().min(1),
    emailId: z.string().trim().min(1),
    phNumber: z.string().trim().min(1),
  }).passthrough(),
  databaseInfo: z.object({
    databaseName: z.string().trim().nullable().optional(),
    // Legacy callers may still supply this; the EO baseline does not need it.
    collectionName: z.string().trim().min(1).optional(),
    tenantId: z.string().trim().min(1),
    botUserId: z.string().trim().min(1),
  }).passthrough(),
  sessionInfo: z.object({
    sessionId: z.string().trim().min(1),
    requestId: z.string().trim().min(1),
  }).passthrough(),
  userMessage: z.string().trim().min(1),
  inputType: z.enum(['text', 'image', 'document']).default('text'),
  attachments: z.array(z.object({
    type: z.enum(['image', 'document']),
    mimeType: z.string().nullable().optional(),
    fileUrl: z.string().trim().min(1),
    thumbnailUrl: z.string().nullable().optional(),
    originalFileName: z.string().nullable().optional(),
  }).passthrough()).default([]),
  metadata: z.object({
    channel: z.string().nullable().optional(),
    fromId: z.string().nullable().optional(),
    localDateTime: z.string().nullable().optional(),
    localTimeZone: z.string().nullable().optional(),
  }).passthrough(),
}).passthrough();

export function normalizeAgentPayload(payload) {
  return agentPayloadSchema.parse(payload);
}

export function buildAgentThreadId(payload, threadIdOverride = null) {
  const normalizedThreadIdOverride = String(threadIdOverride || '').trim();
  if (normalizedThreadIdOverride) {
    return normalizedThreadIdOverride;
  }

  const normalizedPayload = normalizeAgentPayload(payload);
  const identity = [
    normalizedPayload.databaseInfo.tenantId,
    normalizedPayload.databaseInfo.botUserId,
    normalizedPayload.metadata.fromId || normalizedPayload.customerInfo.emailId,
    normalizedPayload.sessionInfo.sessionId,
  ].join('|');

  return `chat_${crypto.createHash('sha256').update(identity).digest('hex')}`;
}

export { agentPayloadSchema };

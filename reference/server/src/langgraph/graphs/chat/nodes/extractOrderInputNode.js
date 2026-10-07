import { z } from 'zod';
import xlsx from 'xlsx';
import { logger } from '../../../../config/logger.js';
import { requestHttp } from '../../../../utils/httpClient.js';

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const SUPPORTED_TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/csv',
  'application/csv',
]);

const SUPPORTED_SHEET_MIME_TYPES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const SUPPORTED_WORD_MIME_TYPES = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const extractedOrderSchema = z.object({
  summary: z.string().trim().nullable().optional(),
  items: z.array(z.object({
    rawText: z.string().trim().min(1),
    skuCandidate: z.string().trim().nullable().optional(),
    quantity: z.number().int().positive().nullable().optional(),
    description: z.string().trim().nullable().optional(),
    dimensions: z.object({
      width: z.number().positive().nullable().optional(),
      height: z.number().positive().nullable().optional(),
      depth: z.number().positive().nullable().optional(),
    }).nullable().optional(),
    sketchHints: z.object({
      cabinetType: z.string().trim().nullable().optional(),
      doorStyle: z.string().trim().nullable().optional(),
      doorCount: z.number().int().positive().nullable().optional(),
      sectionCount: z.number().int().positive().nullable().optional(),
      sectionWidth: z.number().positive().nullable().optional(),
      notes: z.array(z.string().trim().min(1)).default([]),
    }).nullable().optional(),
    confidence: z.enum(['high', 'medium', 'low']).default('medium'),
    uncertainFields: z.array(z.enum(['sku', 'description', 'quantity', 'dimensions', 'sketch_hints'])).default([]),
    uncertaintyNote: z.string().trim().nullable().optional(),
  })).default([]),
  notes: z.array(z.string().trim().min(1)).default([]),
});

const extractedFallbackTextSchema = z.object({
  summary: z.string().trim().nullable().optional(),
  lines: z.array(z.string().trim().min(1)).default([]),
  notes: z.array(z.string().trim().min(1)).default([]),
});

function normalizeText(value) {
  return String(value || '').trim();
}

function inferMimeType(attachment = {}) {
  const attachmentMimeType = normalizeText(attachment.mimeType).toLowerCase();

  if (attachmentMimeType === 'image') {
    const fileName = normalizeText(attachment.originalFileName).toLowerCase();

    if (fileName.endsWith('.png')) {
      return 'image/png';
    }

    if (fileName.endsWith('.gif')) {
      return 'image/gif';
    }

    if (fileName.endsWith('.webp')) {
      return 'image/webp';
    }

    return 'image/jpeg';
  }

  if (attachmentMimeType === 'document') {
    const fileName = normalizeText(attachment.originalFileName).toLowerCase();

    if (fileName.endsWith('.pdf')) {
      return 'application/pdf';
    }

    if (fileName.endsWith('.csv')) {
      return 'text/csv';
    }

    if (fileName.endsWith('.txt')) {
      return 'text/plain';
    }

    if (fileName.endsWith('.xlsx')) {
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }

    if (fileName.endsWith('.xls')) {
      return 'application/vnd.ms-excel';
    }

    if (fileName.endsWith('.docx')) {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }

    if (fileName.endsWith('.doc')) {
      return 'application/msword';
    }
  }

  return attachmentMimeType || 'application/octet-stream';
}

function buildSyntheticOrderText(items = [], summary = '') {
  const normalizedSummary = normalizeText(summary);
  const lines = items.map((item, index) => {
    const skuOrDescription = normalizeText(item.skuCandidate) || normalizeText(item.description) || normalizeText(item.rawText);
    const quantity = Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0
      ? ` qty ${Number(item.quantity)}`
      : '';
    return `${index + 1}. ${skuOrDescription}${quantity}`.trim();
  });

  return [normalizedSummary, ...lines].filter(Boolean).join('\n');
}

function buildFallbackExtractionText(summary = '', notes = []) {
  const normalizedSummary = normalizeText(summary);
  const normalizedNotes = Array.isArray(notes)
    ? notes.map((note) => normalizeText(note)).filter(Boolean)
    : [];

  return [normalizedSummary, ...normalizedNotes].filter(Boolean).join('\n').trim();
}

function buildSketchHintText(sketchHints = null) {
  if (!sketchHints || typeof sketchHints !== 'object') {
    return '';
  }

  const parts = [
    normalizeText(sketchHints.cabinetType),
    normalizeText(sketchHints.doorStyle),
  ].filter(Boolean);

  if (Number.isFinite(Number(sketchHints.doorCount)) && Number(sketchHints.doorCount) > 0) {
    parts.push(`${Number(sketchHints.doorCount)} door`);
  }

  if (Number.isFinite(Number(sketchHints.sectionCount)) && Number(sketchHints.sectionCount) > 0) {
    parts.push(`${Number(sketchHints.sectionCount)} section`);
  }

  if (Number.isFinite(Number(sketchHints.sectionWidth)) && Number(sketchHints.sectionWidth) > 0) {
    parts.push(`${Number(sketchHints.sectionWidth)} inch section`);
  }

  if (Array.isArray(sketchHints.notes)) {
    parts.push(...sketchHints.notes.map((note) => normalizeText(note)).filter(Boolean));
  }

  return [...new Set(parts)].join(' ');
}

function sanitizeSketchHints(sketchHints = null) {
  if (!sketchHints || typeof sketchHints !== 'object') {
    return null;
  }

  const sanitized = {
    cabinetType: normalizeText(sketchHints.cabinetType) || null,
    doorStyle: normalizeText(sketchHints.doorStyle) || null,
    doorCount: Number.isFinite(Number(sketchHints.doorCount)) && Number(sketchHints.doorCount) > 0
      ? Number(sketchHints.doorCount)
      : null,
    sectionCount: Number.isFinite(Number(sketchHints.sectionCount)) && Number(sketchHints.sectionCount) > 0
      ? Number(sketchHints.sectionCount)
      : null,
    sectionWidth: Number.isFinite(Number(sketchHints.sectionWidth)) && Number(sketchHints.sectionWidth) > 0
      ? Number(sketchHints.sectionWidth)
      : null,
    notes: Array.isArray(sketchHints.notes)
      ? sketchHints.notes.map((note) => normalizeText(note)).filter(Boolean)
      : [],
  };

  return Object.values({ ...sanitized, notes: null }).some((value) => value != null) || sanitized.notes.length
    ? sanitized
    : null;
}

function sanitizeExtractedItems(items = []) {
  return items
    .map((item) => {
      const skuCandidate = normalizeText(item.skuCandidate) || null;
      const baseDescription = normalizeText(item.description) || null;
      const sketchHints = sanitizeSketchHints(item.sketchHints);
      const sketchHintText = buildSketchHintText(sketchHints);
      const description = [baseDescription, sketchHintText].filter(Boolean).join(' ').trim() || null;
      const rawText = normalizeText(item.rawText) || description || skuCandidate;
      const quantity = Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0
        ? Number(item.quantity)
        : null;
      const dimensions = item.dimensions && typeof item.dimensions === 'object'
        ? {
          width: Number.isFinite(Number(item.dimensions.width)) ? Number(item.dimensions.width) : null,
          height: Number.isFinite(Number(item.dimensions.height)) ? Number(item.dimensions.height) : null,
          depth: Number.isFinite(Number(item.dimensions.depth)) ? Number(item.dimensions.depth) : null,
        }
        : null;
      const confidence = ['high', 'medium', 'low'].includes(item.confidence)
        ? item.confidence
        : 'medium';
      const uncertainFields = Array.isArray(item.uncertainFields)
        ? [...new Set(item.uncertainFields.filter((field) => ['sku', 'description', 'quantity', 'dimensions', 'sketch_hints'].includes(field)))]
        : [];

      if (!rawText) {
        return null;
      }

      return {
        rawText,
        skuCandidate,
        quantity,
        description,
        dimensions,
        sketchHints,
        confidence,
        uncertainFields,
        uncertaintyNote: normalizeText(item.uncertaintyNote) || null,
      };
    })
    .filter(Boolean);
}

function buildPendingImageConfirmation(extractedItems = []) {
  const uncertainItems = extractedItems
    .map((item, index) => ({
      itemNumber: index + 1,
      uncertainFields: item.uncertainFields?.length
        ? item.uncertainFields
        : item.confidence === 'low'
          ? ['description']
          : [],
      uncertaintyNote: item.uncertaintyNote || null,
    }))
    .filter((item) => item.uncertainFields.length);

  return uncertainItems.length ? { uncertainItems } : null;
}

function buildClarificationMessage(attachment = {}, mimeType = '') {
  const fileName = normalizeText(attachment.originalFileName) || 'the uploaded file';

  if (SUPPORTED_WORD_MIME_TYPES.has(mimeType)) {
    return `I received ${fileName}, but I could not reliably extract cabinet order lines from this Word file. Please upload it as a PDF or image, or paste the item list with quantities here.`;
  }

  return `I received ${fileName}, but I could not reliably read the order lines. Please send a clearer image, upload a PDF, or type the SKU or product description with quantity.`;
}

function workbookToText(buffer) {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  return workbook.SheetNames
    .map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const csv = xlsx.utils.sheet_to_csv(sheet);
      return `Sheet: ${sheetName}\n${csv}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

async function fetchAttachmentBuffer(attachment, requestId) {
  const response = await requestHttp(attachment.fileUrl, {
    method: 'get',
    responseType: 'arraybuffer',
    requestId,
    label: 'Order attachment download',
  });

  return Buffer.from(response.data);
}

async function extractStructuredItemsFromModel({
  model,
  attachment,
  mimeType,
  buffer,
}) {
  const structuredModel = model.withStructuredOutput(extractedOrderSchema, {
    name: 'order_file_extraction',
  });
  const systemPrompt = [
    'Read the uploaded customer order file and extract every order line you can identify.',
    'Treat drawings, handwritten notes, screenshots, and order sheets as possible multi-item orders.',
    'Return one item for each distinct line or drawing label mentioned by the customer.',
    'Preserve the raw item wording in rawText.',
    'If a SKU is visible, put it in skuCandidate.',
    'If dimensions are visible, capture width, height, and depth only when explicitly shown.',
    'For cabinet hand sketches, also capture sketchHints when visible or strongly implied by the drawing, such as cabinet type, glass door style, single-door or double-door layout, section count, and section width notes like 15 inch section.',
    'If quantity is visible, capture it as an integer.',
    'Do not invent quantities or SKUs.',
    'For every item, set confidence to high, medium, or low. Mark sku, description, quantity, dimensions, or sketch_hints in uncertainFields whenever handwriting, image quality, or an incomplete drawing makes that value uncertain. Use uncertaintyNote for a short explanation.',
    'If some items are unreadable, still return the readable ones and mention the uncertainty in notes.',
  ].join(' ');
  const userContent = [
    {
      type: 'text',
      text: 'Extract the cabinet order items from this uploaded file.',
    },
  ];

  if (SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    userContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: mimeType,
        data: buffer.toString('base64'),
      },
    });
  } else if (mimeType === 'application/pdf') {
    userContent.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: buffer.toString('base64'),
      },
    });
  } else {
    throw new Error(`Unsupported model extraction MIME type: ${mimeType}`);
  }

  return structuredModel.invoke([
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: userContent,
    },
  ]);
}

async function extractStructuredItemsFromPlainText({ model, text }) {
  const normalizedText = normalizeText(text);

  if (!normalizedText) {
    return {
      summary: null,
      items: [],
      notes: [],
    };
  }

  const structuredModel = model.withStructuredOutput(extractedOrderSchema, {
    name: 'order_text_extraction',
  });

  return structuredModel.invoke([
    {
      role: 'system',
      content: [
        'Read the customer order text and extract every distinct order line.',
        'Return one item per line when possible.',
        'Preserve rawText, extract skuCandidate when present, and quantity when visible.',
        'Do not invent missing values.',
      ].join(' '),
    },
    {
      role: 'user',
      content: normalizedText,
    },
  ]);
}

async function extractFallbackTextFromModel({
  model,
  mimeType,
  buffer,
}) {
  const structuredModel = model.withStructuredOutput(extractedFallbackTextSchema, {
    name: 'order_file_fallback_extraction',
  });
  const systemPrompt = [
    'Read the uploaded customer order file and recover any usable cabinet order text you can.',
    'This is a fallback pass for handwritten sketches, tilted phone photos, cabinet plans, and partially readable images.',
    'Do not require clean SKU extraction.',
    'Return one short line for each distinct cabinet request, section, or labeled drawing that you can read.',
    'Preserve dimension text like 24x36, 27x36, 36x18, 12w x 30h, 96 inch panel, top, base, wall, island, dishwasher, or fridge panel when visible.',
    'If exact wording is unclear, return the most likely readable cabinet description without inventing SKU or quantity.',
    'Use summary for a brief overview and lines for the individual readable requests.',
    'If something is uncertain, mention that in notes instead of leaving everything blank.',
  ].join(' ');
  const userContent = [{
    type: 'text',
    text: 'Recover as much readable cabinet order text as possible from this uploaded file.',
  }];

  if (SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    userContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: mimeType,
        data: buffer.toString('base64'),
      },
    });
  } else if (mimeType === 'application/pdf') {
    userContent.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: buffer.toString('base64'),
      },
    });
  } else {
    throw new Error(`Unsupported fallback extraction MIME type: ${mimeType}`);
  }

  return structuredModel.invoke([
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: userContent,
    },
  ]);
}

// Step 1: attachments are converted into text/items before intent parsing. Text-only
// requests pass through unchanged, keeping the rest of the graph input consistent.
export function createExtractOrderInputNode({
  model,
  fetchAttachmentBufferFn = fetchAttachmentBuffer,
}) {
  return async function extractOrderInputNode(state) {
    const payload = state.agentPayload || {};
    const requestId = payload.sessionInfo?.requestId || 'customer-order-request';
    const attachment = Array.isArray(payload.attachments) ? payload.attachments[0] : null;

    logger.info('LangGraph order input extraction started', {
      requestId,
      inputType: payload.inputType || 'text',
      hasAttachment: Boolean(attachment?.fileUrl),
    });

    if (!attachment?.fileUrl || payload.inputType === 'text') {
      logger.info('LangGraph order input extraction skipped', {
        requestId,
        reason: 'no_attachment',
      });
      return {
        fileExtraction: null,
      };
    }

    const mimeType = inferMimeType(attachment);

    try {
      const buffer = await fetchAttachmentBufferFn(attachment, requestId);
      let extraction;

      if (SUPPORTED_IMAGE_MIME_TYPES.has(mimeType) || mimeType === 'application/pdf') {
        extraction = await extractStructuredItemsFromModel({ model, attachment, mimeType, buffer });
      } else if (SUPPORTED_TEXT_MIME_TYPES.has(mimeType)) {
        extraction = await extractStructuredItemsFromPlainText({
          model,
          text: buffer.toString('utf8'),
        });
      } else if (SUPPORTED_SHEET_MIME_TYPES.has(mimeType)) {
        extraction = await extractStructuredItemsFromPlainText({
          model,
          text: workbookToText(buffer),
        });
      } else {
        return {
          fileExtraction: {
            status: 'failed',
            mimeType,
            extractedItems: [],
            extractedText: '',
            notes: [],
            clarificationQuestion: buildClarificationMessage(attachment, mimeType),
          },
        };
      }

      const extractedItems = sanitizeExtractedItems(extraction.items);
      const extractedText = buildSyntheticOrderText(extractedItems, extraction.summary);
      const fallbackExtractionText = buildFallbackExtractionText(extraction.summary, extraction.notes);

      if (!extractedItems.length) {
        if (SUPPORTED_IMAGE_MIME_TYPES.has(mimeType) || mimeType === 'application/pdf') {
          const fallbackTextExtraction = await extractFallbackTextFromModel({
            model,
            mimeType,
            buffer,
          });
          const modelFallbackText = buildFallbackExtractionText(
            [fallbackTextExtraction.summary, ...(fallbackTextExtraction.lines || [])].filter(Boolean).join('\n'),
            fallbackTextExtraction.notes,
          );

          if (modelFallbackText) {
            logger.info('LangGraph order input extraction recovered text from fallback model pass', {
              requestId,
              mimeType,
            });

            return {
              agentPayload: {
                ...payload,
                userMessage: modelFallbackText,
                metadata: {
                  ...(payload.metadata || {}),
                  originalUserMessage: payload.userMessage,
                  extractedOrderText: modelFallbackText,
                },
              },
              fileExtraction: {
                status: 'success',
                mimeType,
                extractedItems: [],
                extractedText: modelFallbackText,
                notes: fallbackTextExtraction.notes || [],
                clarificationQuestion: null,
              },
            };
          }
        }

        if (fallbackExtractionText) {
          logger.info('LangGraph order input extraction returned fallback text', {
            requestId,
            mimeType,
          });

          return {
            agentPayload: {
              ...payload,
              userMessage: fallbackExtractionText,
              metadata: {
                ...(payload.metadata || {}),
                originalUserMessage: payload.userMessage,
                extractedOrderText: fallbackExtractionText,
              },
            },
            fileExtraction: {
              status: 'success',
              mimeType,
              extractedItems: [],
              extractedText: fallbackExtractionText,
              notes: extraction.notes || [],
              clarificationQuestion: null,
            },
          };
        }

        return {
          fileExtraction: {
            status: 'failed',
            mimeType,
            extractedItems: [],
            extractedText: normalizeText(extraction.summary),
            notes: extraction.notes || [],
            clarificationQuestion: buildClarificationMessage(attachment, mimeType),
          },
        };
      }

      logger.info('LangGraph order input extraction completed', {
        requestId,
        mimeType,
        extractedItemCount: extractedItems.length,
      });

      return {
        agentPayload: {
          ...payload,
          userMessage: extractedText,
          metadata: {
            ...(payload.metadata || {}),
            originalUserMessage: payload.userMessage,
            extractedOrderText: extractedText,
          },
        },
        fileExtraction: {
          status: 'success',
          mimeType,
          extractedItems,
          extractedText,
          notes: extraction.notes || [],
          clarificationQuestion: null,
        },
        pendingImageConfirmation: buildPendingImageConfirmation(extractedItems),
      };
    } catch (error) {
      logger.warn('LangGraph order input extraction failed', {
        requestId,
        mimeType,
        error: error.message,
      });

      return {
        fileExtraction: {
          status: 'failed',
          mimeType,
          extractedItems: [],
          extractedText: '',
          notes: [],
          clarificationQuestion: buildClarificationMessage(attachment, mimeType),
        },
      };
    }
  };
}

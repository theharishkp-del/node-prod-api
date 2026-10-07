import crypto from 'node:crypto';
import { getMasterDbConnection } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { REGISTRY_COLLECTION } from '../models/master/registryModel.js';
import { createBotTask } from './botTaskService.js';
import { sendKafkaMessage } from './kafkaMessageService.js';
import { encodeBase64Value, generateSignalId } from '../utils/standardEO.js';
import { createAndUploadWorkOrderHtml } from './workOrderHtmlService.js';
import { MASTER_DATA_INVENTORY_COLLECTION } from '../models/tenant/masterDataInventoryModel.js';
import { buildSeparatorTolerantSkuRegex, normalizeSku } from '../langgraph/tools/inventoryTools.js';

export const WORK_ORDER_ADMIN_NOTIFICATIONS_COLLECTION = 'md_work_order_admin_notifications';

function normalizeText(value) {
  return String(value || '').trim();
}

async function attachNotificationItemImages({ tenantDb, tenantId, botUserId, workOrder }) {
  const items = Array.isArray(workOrder?.items) && workOrder.items.length
    ? workOrder.items
    : (workOrder?.lineItems || []);
  const missingSkus = [...new Set(items
    .filter((item) => !normalizeText(item?.imageUrl))
    .map((item) => normalizeSku(item?.sku))
    .filter(Boolean))];
  if (!missingSkus.length) return workOrder;

  const inventory = tenantDb.collection(MASTER_DATA_INVENTORY_COLLECTION);
  const inventoryFilter = {
    tenantId,
    normalizedSku: { $in: missingSkus },
    imageUrl: { $exists: true, $ne: null },
    isDeleted: { $ne: true },
    isActive: { $ne: false },
  };
  const inventoryItems = await inventory.find(
    {
      ...(botUserId ? { botUserId } : {}),
      ...inventoryFilter,
    },
    { projection: { sku: 1, normalizedSku: 1, imageUrl: 1, _id: 0 } },
  ).toArray();
  const foundSkus = new Set(inventoryItems.map((item) => normalizeSku(item.normalizedSku || item.sku)));
  const stillMissingSkus = missingSkus.filter((sku) => !foundSkus.has(sku));
  if (botUserId && stillMissingSkus.length) {
    const fallbackItems = await inventory.find(
      {
        tenantId,
        imageUrl: { $exists: true, $ne: null },
        isDeleted: { $ne: true },
        isActive: { $ne: false },
        $or: stillMissingSkus.map((sku) => ({ sku: buildSeparatorTolerantSkuRegex(sku) })),
      },
      { projection: { sku: 1, normalizedSku: 1, imageUrl: 1, _id: 0 } },
    ).toArray();
    inventoryItems.push(...fallbackItems);
  }
  const imageBySku = new Map(inventoryItems.map((item) => [
    normalizeSku(item.normalizedSku || item.sku),
    normalizeText(item.imageUrl),
  ]));
  const enrichedItems = items.map((item) => ({
    ...item,
    imageUrl: normalizeText(item?.imageUrl) || imageBySku.get(normalizeSku(item?.sku)) || '',
  }));

  const unresolvedSkus = enrichedItems
    .filter((item) => !normalizeText(item.imageUrl))
    .map((item) => item.sku)
    .filter(Boolean);
  logger.info('Admin work-order HTML image lookup completed', {
    tenantId,
    botUserId,
    workOrderId: workOrder?.workOrderNumber || workOrder?.workOrderId || null,
    itemCount: items.length,
    requestedSkus: missingSkus,
    inventoryImageMatches: imageBySku.size,
    resolvedImageCount: enrichedItems.length - unresolvedSkus.length,
    unresolvedSkus,
  });

  return Array.isArray(workOrder?.items) && workOrder.items.length
    ? { ...workOrder, items: enrichedItems }
    : { ...workOrder, lineItems: enrichedItems };
}

function resolveAdmins(registry = {}) {
  const seenAdminIds = new Set();

  return (Array.isArray(registry.cybotUsers) ? registry.cybotUsers : [])
    .filter((user) => normalizeText(user?.role).toLowerCase() === 'admin')
    .map((user) => ({
      adminBotUserId: normalizeText(user?.id),
      adminName: normalizeText(user?.uniqueName) || normalizeText(`${user?.firstName || ''} ${user?.lastName || ''}`),
    }))
    .filter((admin) => {
      if (!admin.adminBotUserId || seenAdminIds.has(admin.adminBotUserId)) {
        return false;
      }

      seenAdminIds.add(admin.adminBotUserId);
      return true;
    });
}

async function findTenantAdmins({ tenantId, botUserId, botId }) {
  const masterDb = getMasterDbConnection();
  const registry = await masterDb.collection(REGISTRY_COLLECTION).findOne({
    isActive: { $ne: false },
    $or: [
      ...(tenantId ? [{ tenantId }] : []),
      ...(botUserId ? [{ botUserId }] : []),
      ...(botId ? [{ botId }] : []),
      ...(botId ? [{ 'botMasterKey.botId': botId }] : []),
    ],
  });

  return {
    registry,
    admins: resolveAdmins(registry),
  };
}

function resolveTaskId(response = {}) {
  const candidates = [
    response.taskId,
    response.task_id,
    response.id,
    response.data?.taskId,
    response.data?.task_id,
    response.data?.id,
    response.result?.taskId,
    response.result?.task_id,
  ];

  return candidates.map(normalizeText).find(Boolean) || '';
}

function isSuccessfulTaskResponse(response = {}) {
  const resultCode = normalizeText(response.result_code ?? response.resultCode ?? response.code);
  return !resultCode || resultCode === '0';
}

function formatCurrency(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : '-';
}

function formatRequestedDate(workOrder = {}) {
  const requestedLocalDateTime = normalizeText(workOrder.requestedLocalDateTime);
  const requestedLocalTimeZone = normalizeText(workOrder.requestedLocalTimeZone);

  if (requestedLocalDateTime) {
    return requestedLocalTimeZone
      ? `${requestedLocalDateTime} (${requestedLocalTimeZone})`
      : requestedLocalDateTime;
  }

  const value = workOrder.requestedAt || workOrder.createdAt;
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

function formatPlainEmail(value) {
  // Prevent the chat renderer from turning the visible email into a mailto link.
  return normalizeText(value).replace('@', '@\u200B') || '-';
}

function buildWorkOrderMessage({ workOrder = {}, customer = {}, enrichedWorkOrder = {} }) {
  const lineItems = Array.isArray(workOrder.lineItems) && workOrder.lineItems.length
    ? workOrder.lineItems
    : (Array.isArray(workOrder.items) ? workOrder.items : []);
  const orderLines = lineItems.length
    ? lineItems.map((item, index) => {
      const name = normalizeText(item?.name || item?.itemName) || 'Item';
      const quantity = Number(item?.quantity ?? 0);
      const lineTotal = item?.amount ?? item?.lineTotal;
      return `${index + 1}. *${name}*\n   Qty: ${Number.isFinite(quantity) ? quantity : '-'} | Amount: ${formatCurrency(lineTotal)}`;
    })
    : ['No items available'];
  const customerName = normalizeText(customer?.displayName || workOrder?.customerInfo?.name) || 'Customer';
  const customerEmail = formatPlainEmail(customer?.email || workOrder?.customerInfo?.emailId);
  const quoteLink = normalizeText(workOrder?.s3Documents?.quote?.url || workOrder?.quoteLink) || '-';
  const invoiceLink = normalizeText(workOrder?.s3Documents?.invoice?.url) || '-';

  return [
    '✅ *NEW WORK ORDER CREATED*',
    '',
    `📌 *Sales Order ID:* ${normalizeText(workOrder.salesOrderId) || '-'}`,
    `🧾 *Work Order ID:* ${normalizeText(workOrder.workOrderNumber || workOrder.workOrderId) || '-'}`,
    `🔖 *Order Ref:* ${normalizeText(workOrder.orderReferenceNumber) || '-'}`,
    `📅 *Requested Date:* ${formatRequestedDate(workOrder)}`,
    '',
    '👤 *Customer Details*',
    `*Name:* ${customerName}`,
    `✉️ *Email:* ${customerEmail}`,
    '',
    '🛒 *Order Items*',
    ...orderLines,
    '',
    `💰 *Total Amount:* ${formatCurrency(workOrder.totalAmount ?? workOrder.grandTotal)}`,
    `💳 *Payment Status:* ${normalizeText(workOrder.paymentStatus) || '-'}`,
    `📄 *Quotation:* ${normalizeText(enrichedWorkOrder.quoteNumberRef) || '-'}`,
    ...(quoteLink !== '-' ? [quoteLink] : []),
    `🧾 *Invoice:* ${normalizeText(enrichedWorkOrder.invoiceNumberRef) || '-'}`,
    ...(invoiceLink !== '-' ? [invoiceLink] : []),
  ].join('\n');
}

function buildTaskName(workOrder = {}) {
  const reference = normalizeText(workOrder.salesOrderId || workOrder.workOrderNumber || workOrder.workOrderId);
  return `New work order: ${reference || 'Pending reference'}`;
}

export async function notifyAdminsOfNewWorkOrder({
  tenantDb,
  tenant = {},
  botUserId = '',
  workOrder = {},
  customer = {},
  enrichedWorkOrder = {},
  requestId = '',
} = {}) {
  const tenantId = normalizeText(tenant?.tenantId || workOrder?.tenantId);
  const botId = normalizeText(tenant?.botId || tenant?.botMasterKey?.botId || botUserId);
  const resolvedBotUserId = normalizeText(botUserId || tenant?.botUserId || botId);
  const databaseName = normalizeText(tenant?.botMasterKey?.databaseName || env.botDbName);
  const workOrderDocumentId = workOrder?._id?.toString?.() || normalizeText(workOrder?.id);
  const workOrderId = normalizeText(workOrder?.workOrderNumber || workOrder?.workOrderId);

  if (!tenantDb || !tenantId || !resolvedBotUserId || !workOrderDocumentId || !workOrderId) {
    throw new Error('Tenant, bot, and work-order details are required for admin notifications.');
  }

  const { admins } = await findTenantAdmins({ tenantId, botUserId: resolvedBotUserId, botId });
  if (!admins.length) {
    logger.warn('New work order notification skipped because no admins were found', {
      requestId,
      tenantId,
      botUserId: resolvedBotUserId,
      workOrderId,
    });
    return { notifiedCount: 0, failedCount: 0, skippedCount: 0 };
  }

  const collection = tenantDb.collection(WORK_ORDER_ADMIN_NOTIFICATIONS_COLLECTION);
  const workOrderWithImages = await attachNotificationItemImages({
    tenantDb,
    tenantId,
    botUserId: resolvedBotUserId,
    workOrder,
  });
  const htmlDocument = await createAndUploadWorkOrderHtml({
    workOrder: workOrderWithImages,
    customer,
    enrichedWorkOrder,
    tenantId,
    workOrderId,
  });
  logger.info('Work-order HTML uploaded for admin notification', {
    requestId,
    tenantId,
    workOrderId,
    s3Bucket: htmlDocument.bucket,
    s3Key: htmlDocument.key,
    s3Url: htmlDocument.url,
    fileName: htmlDocument.fileName,
    fileNameFolder: htmlDocument.fileNameFolder,
    mimeType: htmlDocument.mimeType,
    contentType: htmlDocument.contentType,
    htmlCharacterLength: htmlDocument.html.length,
    htmlByteLength: Buffer.byteLength(htmlDocument.html, 'utf8'),
    htmlSha256: crypto.createHash('sha256').update(htmlDocument.html, 'utf8').digest('hex'),
    htmlImageCount: (htmlDocument.html.match(/<img\b/gi) || []).length,
    htmlImageSources: [...htmlDocument.html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)]
      .map((match) => match[1]),
  });
  const results = await Promise.all(admins.map(async (admin) => {
    const mappingFilter = {
      tenantId,
      workOrderDocumentId,
      adminBotUserId: admin.adminBotUserId,
    };
    const existingMapping = await collection.findOne(mappingFilter);

    if (existingMapping?.taskId) {
      return { status: 'skipped', adminBotUserId: admin.adminBotUserId };
    }

    const now = new Date();
    const taskResponse = await createBotTask({
      fromId: resolvedBotUserId,
      databaseName,
      taskName: encodeBase64Value(buildTaskName(workOrder)),
      listTaskToUser: [{ id: admin.adminBotUserId }],
      env: 'prod',
    }, { requestId });
    const taskId = resolveTaskId(taskResponse);
    const taskCreated = isSuccessfulTaskResponse(taskResponse) && Boolean(taskId);

    const mapping = {
      tenantId,
      botId,
      botUserId: resolvedBotUserId,
      databaseName,
      workOrderId,
      workOrderDocumentId,
      salesOrderId: normalizeText(workOrder.salesOrderId) || null,
      adminId: admin.adminBotUserId,
      adminBotUserId: admin.adminBotUserId,
      adminName: admin.adminName || null,
      taskId: taskId || null,
      taskStatus: taskCreated ? 'created' : 'failed',
      taskResponse,
      kafkaStatus: taskCreated ? 'pending' : 'not_sent',
      updatedAt: now,
    };

    await collection.updateOne(
      mappingFilter,
      {
        $set: mapping,
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );

    if (!taskCreated) {
      logger.error('New work order task creation failed for admin', {
        requestId,
        tenantId,
        workOrderId,
        adminBotUserId: admin.adminBotUserId,
        taskResponse,
      });
      return { status: 'failed', adminBotUserId: admin.adminBotUserId };
    }

    try {
      const kafkaPayload = {
        taskId,
        fromId: resolvedBotUserId,
        targetLanguage: 'en',
        parentId: generateSignalId(),
        signalId: generateSignalId(),
        mimeType: 'htmlFile',
        databaseName,
        requestType: 'taskConversation',
        fileName: encodeBase64Value(htmlDocument.fileName),
        fileNameFolder: htmlDocument.fileNameFolder,
      };
      logger.info('Sending work-order HTML notification to Kafka', {
        requestId,
        tenantId,
        workOrderId,
        adminBotUserId: admin.adminBotUserId,
        kafkaUrl: env.kafkaMsgUrlWs,
        payload: kafkaPayload,
      });
      const kafkaResult = await sendKafkaMessage({
        requestId,
        payload: kafkaPayload,
      });
      logger.info('Work-order HTML Kafka notification response', {
        requestId,
        tenantId,
        workOrderId,
        adminBotUserId: admin.adminBotUserId,
        kafkaUrl: env.kafkaMsgUrlWs,
        result: kafkaResult,
      });
      const kafkaStatus = kafkaResult.success ? 'sent' : 'failed';
      await collection.updateOne(mappingFilter, {
        $set: {
          kafkaStatus,
          kafkaResponse: kafkaResult.data,
          kafkaSentAt: kafkaResult.success ? new Date() : null,
          updatedAt: new Date(),
        },
      });
      return { status: kafkaResult.success ? 'notified' : 'failed', adminBotUserId: admin.adminBotUserId };
    } catch (error) {
      await collection.updateOne(mappingFilter, {
        $set: {
          kafkaStatus: 'failed',
          kafkaError: error?.message || String(error),
          updatedAt: new Date(),
        },
      });
      logger.error('New work order Kafka notification failed for admin', {
        requestId,
        tenantId,
        workOrderId,
        adminBotUserId: admin.adminBotUserId,
        error: error?.message || String(error),
      });
      return { status: 'failed', adminBotUserId: admin.adminBotUserId };
    }
  }));

  return {
    notifiedCount: results.filter((result) => result.status === 'notified').length,
    failedCount: results.filter((result) => result.status === 'failed').length,
    skippedCount: results.filter((result) => result.status === 'skipped').length,
  };
}

import {
  attachPaymentLinkToWorkOrder,
  downloadCustomerReport,
  downloadInvoiceReport,
  downloadWorkOrderReport,
  getBusinessDashboardSummary,
  createTier,
  createCustomer,
  createInvoice,
  createPayment,
  createQuote,
  createWorkOrder,
  listCustomerReportPreview,
  deleteTier,
  deleteCustomer,
  deleteInvoice,
  deletePayment,
  deleteQuote,
  getTierById,
  getCustomerById,
  getAdminCalendarEvents,
  getAdminCalendarWorkOrderDetails,
  getWorkOrderDetails,
  getCustomerHistory,
  listCustomersWithoutWorkOrders,
  getCustomerZohoSyncSummary,
  getInvoiceById,
  getInvoicePdfFromZoho,
  getInvoiceZohoSyncSummary,
  getPaymentById,
  getPaymentZohoSyncSummary,
  getQuoteById,
  getQuotePdfFromZoho,
  getQuoteZohoSyncSummary,
  listInvoiceReportPreview,
  listTiers,
  listCustomers,
  listInvoices,
  listPayments,
  listQuotes,
  listWorkOrderReportPreview,
  listWorkOrders,
  updateTier,
  syncAllCustomersToZoho,
  syncAllInvoicesToZoho,
  syncAllPaymentsToZoho,
  syncAllQuotesToZoho,
  syncCustomerToZoho,
  syncInvoiceToZoho,
  syncPaymentToZoho,
  syncQuoteToZoho,
  updateCustomer,
  updateInvoice,
  updatePayment,
  updateQuote,
} from '../../services/masterDataService.js';
import { saveInventoryUpload } from '../../services/inventoryUploadService.js';
import {
  createInventoryProduct,
  deleteInventoryProduct,
  getInventoryProductById,
  getInventorySummary,
  importInventoryWorkbook,
  listInventoryCategories,
  listInventoryImportHistory,
  listInventoryProducts,
  updateInventoryProduct,
  uploadInventoryProductImage,
} from '../../services/inventoryService.js';
import { generateInventoryTemplateBuffer, getInventoryTemplateStatus } from '../../services/inventoryTemplateService.js';
import { getRequestContext, logControllerStep, sendSuccess } from './shared/controllerUtils.js';

export async function listCustomersRequest(req, res, next) {
  try {
    const result = await listCustomers({ ...getRequestContext(req), query: req.query });
    return sendSuccess(res, 200, 'Customers loaded successfully.', result.items, result.pagination);
  } catch (error) {
    next(error);
  }
}

export async function listCustomersWithoutWorkOrdersRequest(req, res, next) {
  try {
    const result = await listCustomersWithoutWorkOrders({ ...getRequestContext(req), query: req.query });
    return sendSuccess(res, 200, 'Customers without work orders loaded successfully.', result.items, result.pagination);
  } catch (error) {
    next(error);
  }
}

export async function listWorkOrdersRequest(req, res, next) {
  try {
    const result = await listWorkOrders({ ...getRequestContext(req), query: req.query });
    return sendSuccess(res, 200, 'Work orders loaded successfully.', result.items, result.pagination);
  } catch (error) {
    next(error);
  }
}

export async function getWorkOrderDetailsRequest(req, res, next) {
  try {
    const result = await getWorkOrderDetails({
      ...getRequestContext(req),
      workOrderNumber: req.params.workOrderNumber,
    });
    return sendSuccess(res, 200, 'Work order details loaded successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function getBusinessDashboardSummaryRequest(req, res, next) {
  try {
    const result = await getBusinessDashboardSummary({ ...getRequestContext(req), query: req.query });
    return sendSuccess(res, 200, 'Business dashboard summary loaded successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function downloadCustomerReportRequest(req, res, next) {
  try {
    const result = await downloadCustomerReport({ ...getRequestContext(req), query: req.query });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    return res.status(200).send(result.buffer);
  } catch (error) {
    next(error);
  }
}

export async function listCustomerReportPreviewRequest(req, res, next) {
  try {
    const result = await listCustomerReportPreview({ ...getRequestContext(req), query: req.query });
    return sendSuccess(res, 200, 'Customer report preview loaded successfully.', result.items, result.pagination);
  } catch (error) {
    next(error);
  }
}

export async function downloadInvoiceReportRequest(req, res, next) {
  try {
    const result = await downloadInvoiceReport({ ...getRequestContext(req), query: req.query });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    return res.status(200).send(result.buffer);
  } catch (error) {
    next(error);
  }
}

export async function listInvoiceReportPreviewRequest(req, res, next) {
  try {
    const result = await listInvoiceReportPreview({ ...getRequestContext(req), query: req.query });
    return sendSuccess(res, 200, 'Invoice report preview loaded successfully.', result.items, result.pagination);
  } catch (error) {
    next(error);
  }
}

export async function downloadWorkOrderReportRequest(req, res, next) {
  try {
    const result = await downloadWorkOrderReport({ ...getRequestContext(req), query: req.query });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    return res.status(200).send(result.buffer);
  } catch (error) {
    next(error);
  }
}

export async function listWorkOrderReportPreviewRequest(req, res, next) {
  try {
    const result = await listWorkOrderReportPreview({ ...getRequestContext(req), query: req.query });
    return sendSuccess(res, 200, 'Work order report preview loaded successfully.', result.items, result.pagination);
  } catch (error) {
    next(error);
  }
}

export async function getAdminCalendarEventsRequest(req, res, next) {
  try {
    const result = await getAdminCalendarEvents({ ...getRequestContext(req), query: req.query });
    return sendSuccess(res, 200, 'Admin calendar events loaded successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function getAdminCalendarWorkOrderDetailsRequest(req, res, next) {
  try {
    const result = await getAdminCalendarWorkOrderDetails({
      ...getRequestContext(req),
      workOrderId: req.params.id,
    });
    return sendSuccess(res, 200, 'Admin work order details loaded successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function createWorkOrderRequest(req, res, next) {
  try {
    const result = await createWorkOrder({
      ...getRequestContext(req),
      payload: req.body,
      requestContext: {
        requestId: req.requestId,
        userId: req.body?.reqMessageObj?.fromId || req.body?.fromId || '',
        databaseName:
          req.body?.reqMessageObj?.databaseName ||
          req.body?.sourcePayload?.reqMessageObj?.databaseName ||
          req.body?.sourcePayload?.databaseInfo?.requestDatabaseName ||
          req.body?.databaseName ||
          req.body?.sourcePayload?.databaseInfo?.databaseName ||
          '',
        usageDate: req.body?.workOrderDate || req.body?.reqMessageObj?.localDateTime || req.body?.reqMessageObj?.createdDate,
      },
    });
    return sendSuccess(res, 201, 'Work order created successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function attachPaymentLinkToWorkOrderRequest(req, res, next) {
  try {
    const result = await attachPaymentLinkToWorkOrder({
      ...getRequestContext(req),
      workOrderNumber: req.params.workOrderNumber,
      payload: req.body,
    });
    return sendSuccess(res, 200, 'Work order payment link attached successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function listTiersRequest(req, res, next) {
  try {
    const result = await listTiers({ ...getRequestContext(req), query: req.query });
    return sendSuccess(res, 200, 'Tiers loaded successfully.', result.items, result.pagination);
  } catch (error) {
    next(error);
  }
}

export async function createTierRequest(req, res, next) {
  try {
    logControllerStep(req, 'Master data tier create started', {
      tierKey: req.body?.tierKey ?? null,
      tierName: req.body?.tierName ?? null,
    });
    
    const result = await createTier({ ...getRequestContext(req), payload: req.body });
    return sendSuccess(res, 201, 'Tier created successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function getTierRequest(req, res, next) {
  try {
    const result = await getTierById({ ...getRequestContext(req), tierId: req.params.id });
    return sendSuccess(res, 200, 'Tier loaded successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function updateTierRequest(req, res, next) {
  try {
    logControllerStep(req, 'Master data tier update started', {
      tierId: req.params.id ?? null,
      tierKey: req.body?.tierKey ?? null,
      tierName: req.body?.tierName ?? null,
    });
    
    const result = await updateTier({
      ...getRequestContext(req),
      tierId: req.params.id,
      payload: req.body,
    });
    return sendSuccess(res, 200, 'Tier updated successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function deleteTierRequest(req, res, next) {
  try {
    await deleteTier({ ...getRequestContext(req), tierId: req.params.id });
    return sendSuccess(res, 200, 'Tier deleted successfully.', {});
  } catch (error) {
    next(error);
  }
}

export async function createCustomerRequest(req, res, next) {
  try {
    logControllerStep(req, 'Master data customer create started', {
      customerName: req.body?.name ?? null,
      customerEmail: req.body?.email ?? null,
      customerPhone: req.body?.phone ?? null,
    });

    const result = await createCustomer({ ...getRequestContext(req), payload: req.body });
    return sendSuccess(res, 201, 'Customer created successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function getCustomerRequest(req, res, next) {
  try {
    const result = await getCustomerById({ ...getRequestContext(req), customerId: req.params.id });
    return sendSuccess(res, 200, 'Customer loaded successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function getCustomerHistoryRequest(req, res, next) {
  try {
    const result = await getCustomerHistory({
      ...getRequestContext(req),
      encodedCustomerContext: req.header('x-customer-context') || req.query.customer,
    });
    return sendSuccess(res, 200, 'Customer history loaded successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function updateCustomerRequest(req, res, next) {
  try {
    const result = await updateCustomer({
      ...getRequestContext(req),
      customerId: req.params.id,
      payload: req.body,
    });
    return sendSuccess(res, 200, 'Customer updated successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function deleteCustomerRequest(req, res, next) {
  try {
    await deleteCustomer({ ...getRequestContext(req), customerId: req.params.id });
    return sendSuccess(res, 200, 'Customer deleted successfully.', {});
  } catch (error) {
    next(error);
  }
}

export async function syncCustomerToZohoRequest(req, res, next) {
  try {
    const result = await syncCustomerToZoho({
      ...getRequestContext(req),
      customerId: req.params.id,
    });
    return sendSuccess(res, 200, 'Customer synced to Zoho Books successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function syncAllCustomersToZohoRequest(req, res, next) {
  try {
    const result = await syncAllCustomersToZoho({
      ...getRequestContext(req),
    });
    return sendSuccess(res, 200, 'Customers sync completed.', result);
  } catch (error) {
    next(error);
  }
}

export async function getCustomerZohoSyncSummaryRequest(req, res, next) {
  try {
    const result = await getCustomerZohoSyncSummary({
      ...getRequestContext(req),
    });
    return sendSuccess(res, 200, 'Customer sync summary loaded successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function listQuotesRequest(req, res, next) {
  try {
    const result = await listQuotes({ ...getRequestContext(req), query: req.query });
    return sendSuccess(res, 200, 'Quotes loaded successfully.', result.items, result.pagination);
  } catch (error) {
    next(error);
  }
}

export async function createQuoteRequest(req, res, next) {
  try {
    const result = await createQuote({ ...getRequestContext(req), payload: req.body });
    return sendSuccess(res, 201, 'Quote created successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function getQuoteRequest(req, res, next) {
  try {
    const result = await getQuoteById({ ...getRequestContext(req), quoteId: req.params.id });
    return sendSuccess(res, 200, 'Quote loaded successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function getQuotePdfRequest(req, res, next) {
  try {
    const result = await getQuotePdfFromZoho({
      ...getRequestContext(req),
      quoteId: req.params.id,
    });

    res.setHeader('Content-Type', result.contentType || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${result.fileName}"`);
    return res.status(200).send(result.buffer);
  } catch (error) {
    next(error);
  }
}

export async function updateQuoteRequest(req, res, next) {
  try {
    const result = await updateQuote({
      ...getRequestContext(req),
      quoteId: req.params.id,
      payload: req.body,
    });
    return sendSuccess(res, 200, 'Quote updated successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function deleteQuoteRequest(req, res, next) {
  try {
    await deleteQuote({ ...getRequestContext(req), quoteId: req.params.id });
    return sendSuccess(res, 200, 'Quote deleted successfully.', {});
  } catch (error) {
    next(error);
  }
}

export async function syncQuoteToZohoRequest(req, res, next) {
  try {
    const result = await syncQuoteToZoho({
      ...getRequestContext(req),
      quoteId: req.params.id,
    });
    return sendSuccess(res, 200, 'Quote synced to Zoho Books successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function syncAllQuotesToZohoRequest(req, res, next) {
  try {
    const result = await syncAllQuotesToZoho({
      ...getRequestContext(req),
    });
    return sendSuccess(res, 200, 'Quotes sync completed.', result);
  } catch (error) {
    next(error);
  }
}

export async function getQuoteZohoSyncSummaryRequest(req, res, next) {
  try {
    const result = await getQuoteZohoSyncSummary({
      ...getRequestContext(req),
    });
    return sendSuccess(res, 200, 'Quote sync summary loaded successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function listInvoicesRequest(req, res, next) {
  try {
    const result = await listInvoices({ ...getRequestContext(req), query: req.query });
    return sendSuccess(res, 200, 'Invoices loaded successfully.', result.items, result.pagination);
  } catch (error) {
    next(error);
  }
}

export async function createInvoiceRequest(req, res, next) {
  try {
    const result = await createInvoice({ ...getRequestContext(req), payload: req.body });
    return sendSuccess(res, 201, 'Invoice created successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function getInvoiceRequest(req, res, next) {
  try {
    const result = await getInvoiceById({ ...getRequestContext(req), invoiceId: req.params.id });
    return sendSuccess(res, 200, 'Invoice loaded successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function getInvoicePdfRequest(req, res, next) {
  try {
    const result = await getInvoicePdfFromZoho({
      ...getRequestContext(req),
      invoiceId: req.params.id,
    });

    res.setHeader('Content-Type', result.contentType || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${result.fileName}"`);
    return res.status(200).send(result.buffer);
  } catch (error) {
    next(error);
  }
}

export async function updateInvoiceRequest(req, res, next) {
  try {
    const result = await updateInvoice({
      ...getRequestContext(req),
      invoiceId: req.params.id,
      payload: req.body,
    });
    return sendSuccess(res, 200, 'Invoice updated successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function deleteInvoiceRequest(req, res, next) {
  try {
    await deleteInvoice({ ...getRequestContext(req), invoiceId: req.params.id });
    return sendSuccess(res, 200, 'Invoice deleted successfully.', {});
  } catch (error) {
    next(error);
  }
}

export async function syncInvoiceToZohoRequest(req, res, next) {
  try {
    const result = await syncInvoiceToZoho({
      ...getRequestContext(req),
      invoiceId: req.params.id,
    });
    return sendSuccess(res, 200, 'Invoice synced to Zoho Books successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function syncAllInvoicesToZohoRequest(req, res, next) {
  try {
    const result = await syncAllInvoicesToZoho({
      ...getRequestContext(req),
    });
    return sendSuccess(res, 200, 'Invoices sync completed.', result);
  } catch (error) {
    next(error);
  }
}

export async function getInvoiceZohoSyncSummaryRequest(req, res, next) {
  try {
    const result = await getInvoiceZohoSyncSummary({
      ...getRequestContext(req),
    });
    return sendSuccess(res, 200, 'Invoice sync summary loaded successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function listPaymentsRequest(req, res, next) {
  try {
    const result = await listPayments({ ...getRequestContext(req), query: req.query });
    return sendSuccess(res, 200, 'Payments loaded successfully.', result.items, result.pagination);
  } catch (error) {
    next(error);
  }
}

export async function createPaymentRequest(req, res, next) {
  try {
    const result = await createPayment({ ...getRequestContext(req), payload: req.body });
    return sendSuccess(res, 201, 'Payment created successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function getPaymentRequest(req, res, next) {
  try {
    const result = await getPaymentById({ ...getRequestContext(req), paymentId: req.params.id });
    return sendSuccess(res, 200, 'Payment loaded successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function updatePaymentRequest(req, res, next) {
  try {
    const result = await updatePayment({
      ...getRequestContext(req),
      paymentId: req.params.id,
      payload: req.body,
    });
    return sendSuccess(res, 200, 'Payment updated successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function deletePaymentRequest(req, res, next) {
  try {
    await deletePayment({ ...getRequestContext(req), paymentId: req.params.id });
    return sendSuccess(res, 200, 'Payment deleted successfully.', {});
  } catch (error) {
    next(error);
  }
}

export async function syncPaymentToZohoRequest(req, res, next) {
  try {
    const result = await syncPaymentToZoho({
      ...getRequestContext(req),
      paymentId: req.params.id,
    });
    return sendSuccess(res, 200, 'Payment synced to Zoho Books successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function syncAllPaymentsToZohoRequest(req, res, next) {
  try {
    const result = await syncAllPaymentsToZoho({
      ...getRequestContext(req),
    });
    return sendSuccess(res, 200, 'Payments sync completed.', result);
  } catch (error) {
    next(error);
  }
}

export async function getPaymentZohoSyncSummaryRequest(req, res, next) {
  try {
    const result = await getPaymentZohoSyncSummary({
      ...getRequestContext(req),
    });
    return sendSuccess(res, 200, 'Payment sync summary loaded successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function uploadInventoryRequest(req, res, next) {
  try {
    logControllerStep(req, 'Inventory upload started', {
      originalFileName: req.file?.originalname,
      mimeType: req.file?.mimetype,
      size: req.file?.size,
      mode: req.body?.mode ?? null,
    });

    const uploadMetadata = await saveInventoryUpload({
      file: req.file,
      botUserId: req.botUserId,
    });
    const importResult = await importInventoryWorkbook({
      ...getRequestContext(req),
      file: req.file,
      mode: req.body?.mode,
    });

    return sendSuccess(res, 201, 'Inventory file uploaded and imported successfully.', {
      ...uploadMetadata,
      ...importResult,
    });
  } catch (error) {
    next(error);
  }
}

export async function downloadInventoryTemplateRequest(_req, res, next) {
  try {
    const templateBuffer = generateInventoryTemplateBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="InventoryProduct.xlsx"');
    return res.status(200).send(templateBuffer);
  } catch (error) {
    next(error);
  }
}

export async function listInventoryProductsRequest(req, res, next) {
  try {
    const result = await listInventoryProducts({ ...getRequestContext(req), query: req.query });
    return sendSuccess(res, 200, 'Inventory products loaded successfully.', result.items, result.pagination);
  } catch (error) {
    next(error);
  }
}

export async function getInventoryProductRequest(req, res, next) {
  try {
    const result = await getInventoryProductById({ ...getRequestContext(req), inventoryId: req.params.id });
    return sendSuccess(res, 200, 'Inventory product loaded successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function createInventoryProductRequest(req, res, next) {
  try {
    const result = await createInventoryProduct({ ...getRequestContext(req), payload: req.body });
    return sendSuccess(res, 201, 'Inventory product created successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function updateInventoryProductRequest(req, res, next) {
  try {
    const result = await updateInventoryProduct({
      ...getRequestContext(req),
      inventoryId: req.params.id,
      payload: req.body,
    });
    return sendSuccess(res, 200, 'Inventory product updated successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function deleteInventoryProductRequest(req, res, next) {
  try {
    await deleteInventoryProduct({ ...getRequestContext(req), inventoryId: req.params.id });
    return sendSuccess(res, 200, 'Inventory product deleted successfully.', {});
  } catch (error) {
    next(error);
  }
}

export async function getInventorySummaryRequest(req, res, next) {
  try {
    const result = await getInventorySummary({ ...getRequestContext(req) });
    return sendSuccess(res, 200, 'Inventory summary loaded successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function listInventoryCategoriesRequest(req, res, next) {
  try {
    const result = await listInventoryCategories({ ...getRequestContext(req) });
    return sendSuccess(res, 200, 'Inventory categories loaded successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function listInventoryImportHistoryRequest(req, res, next) {
  try {
    const result = await listInventoryImportHistory({ ...getRequestContext(req), query: req.query });
    return sendSuccess(res, 200, 'Inventory import history loaded successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function getInventoryTemplateStatusRequest(_req, res, next) {
  try {
    const result = getInventoryTemplateStatus();
    return sendSuccess(
      res,
      result.available ? 200 : 404,
      result.available ? 'Inventory template is available.' : 'Inventory template is not available.',
      result
    );
  } catch (error) {
    next(error);
  }
}
export async function uploadInventoryProductImageRequest(req, res, next) {
  try {
    const result = await uploadInventoryProductImage({
      ...getRequestContext(req),
      inventoryId: req.params.id,
      file: req.file,
    });
    return sendSuccess(res, 200, 'Product image uploaded successfully.', result);
  } catch (error) {
    next(error);
  }
}

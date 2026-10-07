import { Router } from 'express';
import { inventoryUpload } from '../../middleware/inventoryUploadMiddleware.js';
import { inventoryImageUpload } from '../../middleware/inventoryImageUploadMiddleware.js';
import { tenantInterceptor } from '../../middleware/tenantMiddleware.js';
import {
  createTierRequest,
  deleteTierRequest,
  getTierRequest,
  listTiersRequest,
  updateTierRequest,
} from '../../controller/web/tierController.js';
import {
  createCustomerRequest,
  deleteCustomerRequest,
  getCustomerHistoryRequest,
  getCustomerRequest,
  getCustomerZohoSyncSummaryRequest,
  listCustomersRequest,
  listCustomersWithoutWorkOrdersRequest,
  syncAllCustomersToZohoRequest,
  syncCustomerToZohoRequest,
  updateCustomerRequest,
} from '../../controller/web/customerController.js';
import {
  listCustomerReportPreviewRequest,
  listInvoiceReportPreviewRequest,
  listWorkOrderReportPreviewRequest,
  downloadCustomerReportRequest,
  downloadInvoiceReportRequest,
  downloadWorkOrderReportRequest,
  getBusinessDashboardSummaryRequest,
} from '../../controller/web/dashboardController.js';
import {
  getAdminCalendarEventsRequest,
  getAdminCalendarWorkOrderDetailsRequest,
} from '../../controller/web/calendarController.js';
import {
  createQuoteRequest,
  deleteQuoteRequest,
  getQuotePdfRequest,
  getQuoteRequest,
  getQuoteZohoSyncSummaryRequest,
  listQuotesRequest,
  syncAllQuotesToZohoRequest,
  syncQuoteToZohoRequest,
  updateQuoteRequest,
} from '../../controller/web/quoteController.js';
import {
  createInvoiceRequest,
  deleteInvoiceRequest,
  getInvoicePdfRequest,
  getInvoiceRequest,
  getInvoiceZohoSyncSummaryRequest,
  listInvoicesRequest,
  syncAllInvoicesToZohoRequest,
  syncInvoiceToZohoRequest,
  updateInvoiceRequest,
} from '../../controller/web/invoiceController.js';
import {
  createPaymentRequest,
  deletePaymentRequest,
  getPaymentRequest,
  getPaymentZohoSyncSummaryRequest,
  listPaymentsRequest,
  syncAllPaymentsToZohoRequest,
  syncPaymentToZohoRequest,
  updatePaymentRequest,
} from '../../controller/web/paymentController.js';
import {
  attachPaymentLinkToWorkOrderRequest,
  createWorkOrderRequest,
  getWorkOrderDetailsRequest,
  listWorkOrdersRequest,
} from '../../controller/web/workOrderController.js';
import {
  createInventoryProductRequest,
  deleteInventoryProductRequest,
  downloadInventoryTemplateRequest,
  getInventoryProductRequest,
  getInventorySummaryRequest,
  getInventoryTemplateStatusRequest,
  listInventoryCategoriesRequest,
  listInventoryImportHistoryRequest,
  listInventoryProductsRequest,
  updateInventoryProductRequest,
  uploadInventoryRequest,
  uploadInventoryProductImageRequest,
} from '../../controller/web/inventoryController.js';

const router = Router();

router.use(tenantInterceptor);

router.get('/tiers', listTiersRequest);
router.post('/tiers', createTierRequest);
router.get('/tiers/:id', getTierRequest);
router.put('/tiers/:id', updateTierRequest);
router.delete('/tiers/:id', deleteTierRequest);

router.get('/customers', listCustomersRequest);
router.get('/customer-history', getCustomerHistoryRequest);
router.get('/dashboard/summary', getBusinessDashboardSummaryRequest);
router.get('/reports/customers', listCustomerReportPreviewRequest);
router.get('/reports/invoices', listInvoiceReportPreviewRequest);
router.get('/reports/work-orders', listWorkOrderReportPreviewRequest);
router.get('/reports/customers/download', downloadCustomerReportRequest);
router.get('/reports/invoices/download', downloadInvoiceReportRequest);
router.get('/reports/work-orders/download', downloadWorkOrderReportRequest);
router.get('/calendar/events', getAdminCalendarEventsRequest);
router.get('/calendar/work-orders/:id', getAdminCalendarWorkOrderDetailsRequest);
router.get('/customers/without-work-orders', listCustomersWithoutWorkOrdersRequest);
router.post('/customers', createCustomerRequest);
router.get('/customers/sync-summary', getCustomerZohoSyncSummaryRequest);
router.post('/customers/sync', syncAllCustomersToZohoRequest);
router.get('/customers/:id', getCustomerRequest);
router.put('/customers/:id', updateCustomerRequest);
router.delete('/customers/:id', deleteCustomerRequest);
router.post('/customers/:id/sync', syncCustomerToZohoRequest);

router.get('/quotes', listQuotesRequest);
router.post('/quotes', createQuoteRequest);
router.get('/quotes/sync-summary', getQuoteZohoSyncSummaryRequest);
router.post('/quotes/sync', syncAllQuotesToZohoRequest);
router.get('/quotes/:id/pdf', getQuotePdfRequest);
router.get('/quotes/:id', getQuoteRequest);
router.put('/quotes/:id', updateQuoteRequest);
router.delete('/quotes/:id', deleteQuoteRequest);
router.post('/quotes/:id/sync', syncQuoteToZohoRequest);

router.get('/invoices', listInvoicesRequest);
router.post('/invoices', createInvoiceRequest);
router.get('/invoices/sync-summary', getInvoiceZohoSyncSummaryRequest);
router.post('/invoices/sync', syncAllInvoicesToZohoRequest);
router.get('/invoices/:id/pdf', getInvoicePdfRequest);
router.get('/invoices/:id', getInvoiceRequest);
router.put('/invoices/:id', updateInvoiceRequest);
router.delete('/invoices/:id', deleteInvoiceRequest);
router.post('/invoices/:id/sync', syncInvoiceToZohoRequest);

router.get('/payments', listPaymentsRequest);
router.post('/payments', createPaymentRequest);
router.get('/payments/sync-summary', getPaymentZohoSyncSummaryRequest);
router.post('/payments/sync', syncAllPaymentsToZohoRequest);
router.get('/payments/:id', getPaymentRequest);
router.put('/payments/:id', updatePaymentRequest);
router.delete('/payments/:id', deletePaymentRequest);
router.post('/payments/:id/sync', syncPaymentToZohoRequest);

router.get('/work-orders', listWorkOrdersRequest);
router.post('/work-orders', createWorkOrderRequest);
router.get('/work-orders/:workOrderNumber/details', getWorkOrderDetailsRequest);
router.post('/work-orders/:workOrderNumber/payment-link', attachPaymentLinkToWorkOrderRequest);

router.get('/inventory/template/download', downloadInventoryTemplateRequest);
router.get('/inventory/template/status', getInventoryTemplateStatusRequest);
router.get('/inventory', listInventoryProductsRequest);
router.post('/inventory', createInventoryProductRequest);
router.get('/inventory/categories', listInventoryCategoriesRequest);
router.get('/inventory/import-history', listInventoryImportHistoryRequest);
router.get('/inventory/summary', getInventorySummaryRequest);
router.post('/inventory/upload', inventoryUpload.single('file'), uploadInventoryRequest);
router.get('/inventory/:id', getInventoryProductRequest);
router.put('/inventory/:id', updateInventoryProductRequest);
router.delete('/inventory/:id', deleteInventoryProductRequest);
router.post('/inventory/:id/image', inventoryImageUpload.single('image'), uploadInventoryProductImageRequest);

export default router;

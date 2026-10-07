export type MasterDataFormMode = 'create' | 'edit' | 'view';

export interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface MasterDataApiResponse<T> {
  status: 'ok' | 'error';
  message: string;
  data: T;
  pagination?: PaginationState;
}

export interface MasterDataListQuery {
  search?: string;
  customerSearch?: string;
  status?: string;
  paymentStatus?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export type DeveloperMonitorScope = 'master' | 'tenant';

export interface DeveloperCollectionSummary {
  name: string;
  documentCount: number;
  sampleKeys: string[];
  latestDocumentId?: string | null;
  latestActivityAt?: string | null;
}

export interface DeveloperDatabaseSummary {
  name: string;
  collectionCount: number;
  totalDocuments: number;
  collections: DeveloperCollectionSummary[];
}

export interface DeveloperLogEntry {
  timestamp: string;
  level: string;
  message: string;
  service?: string;
  filename?: string;
  functionName?: string;
  requestId?: string;
  [key: string]: unknown;
}

export interface DeveloperMonitorTenant {
  tenantId: string;
  botUserId: string;
  databaseName: string;
  companyName: string;
}

export interface DeveloperMonitorOverview {
  generatedAt: string;
  tenantContext: {
    botUserId?: string | null;
    tenantId?: string | null;
    tenantName?: string | null;
    databaseName?: string | null;
    registryDocumentId?: string | null;
  };
  tenants: DeveloperMonitorTenant[];
  logConfig: {
    directory: string;
    bufferLimit: number;
    availableCount: number;
    returnedCount: number;
    activeLevelFilter: string;
    activeSearch: string;
    activeDate: string;
    source: string;
  };
  tenantRoutingCache: {
    sizes: {
      registry: number;
      tenantDb: number;
    };
    registryCacheKeys: string[];
    databaseNameCache: Array<{
      cacheKey: string;
      databaseName: string | null;
    }>;
    tenantDbCacheKeys: string[];
  };
  masterDatabase: DeveloperDatabaseSummary;
  tenantDatabase: DeveloperDatabaseSummary;
  recentLogs: DeveloperLogEntry[];
}

export interface DeveloperMonitorLogsPayload {
  generatedAt: string;
  limit: number;
  selectedDate: string;
  source: string;
  totalAvailable: number;
  returnedCount: number;
  items: DeveloperLogEntry[];
}

export interface DeveloperCollectionPreview {
  scope: DeveloperMonitorScope;
  databaseName: string;
  collectionName: string;
  limit: number;
  returnedCount: number;
  documents: Array<Record<string, unknown>>;
}

export interface DeveloperCollectionDeleteResult {
  scope: DeveloperMonitorScope;
  databaseName: string;
  deletedCollectionNames: string[];
}

export type DashboardPeriod = 'day' | 'week' | 'month' | 'custom';

export interface DashboardSummaryQuery {
  period?: DashboardPeriod;
  from?: string;
  to?: string;
}

export interface ReportDownloadQuery {
  search?: string;
  period?: DashboardPeriod;
  from?: string;
  to?: string;
  customerId?: string;
  page?: number;
  pageSize?: number;
}

export interface LineItemValue {
  itemId?: string | null;
  name: string;
  description?: string | null;
  quantity: number;
  rate: number;
  discount: number;
  taxPercentage: number;
  taxAmount: number;
  amount: number;
}

export interface MasterDataCustomer {
  id: string;
  hasWorkOrder?: boolean;
  customerCode?: string | null;
  tierId?: string | null;
  tierKey?: string | null;
  tierName?: string | null;
  tierMultiplier?: number | null;
  customerType: 'business' | 'individual';
  displayName: string;
  companyName?: string | null;
  email?: string | null;
  phoneCountryCode?: string | null;
  phone?: string | null;
  mobileCountryCode?: string | null;
  mobile?: string | null;
  gstNumber?: string | null;
  taxTreatment?: string | null;
  billingAddress: string;
  shippingAddress?: string | null;
  currencyCode?: string | null;
  paymentTerms?: string | null;
  status: 'active' | 'inactive';
  zohoCustomerId?: string | null;
  zohoSyncStatus: 'not_synced' | 'synced' | 'failed';
  zohoLastSyncedAt?: string | null;
  zohoErrorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MasterDataWorkOrder {
  id: string;
  workOrderNumber: string;
  workOrderId?: string;
  salesOrderId?: string;
  orderReferenceNumber?: string;
  customerId: string;
  customerDisplayName?: string;
  customerCode?: string | null;
  customerInfo?: {
    name?: string | null;
    emailId?: string | null;
    phNumber?: string | null;
  };
  quoteId?: string | null;
  quoteNumberRef?: string;
  invoiceId?: string | null;
  invoiceNumberRef?: string;
  paymentIds: string[];
  paymentLink?: string | null;
  branchId?: string | null;
  status: string;
  paymentStatus: string;
  dispatchStatus?: string | null;
  pickupStatus?: string | null;
  deliveryMode: string;
  fulfillmentMode?: string | null;
  requestedAt?: string | null;
  requestedLocalDateTime?: string | null;
  requestedLocalTimeZone?: string | null;
  totalAmount?: number | null;
  grandTotal?: number | null;
  paidAmount?: number | null;
  balanceAmount?: number | null;
  customerRequestNotes?: string | null;
  internalNotes?: string | null;
  lineItems?: LineItemValue[];
  items?: Array<{
    sku?: string | null;
    itemName?: string | null;
    quantity?: number | null;
    lineTotal?: number | null;
  }>;
  taskSummary?: {
    totalTasks?: number | null;
    pendingTasks?: number | null;
    inProgressTasks?: number | null;
    completedTasks?: number | null;
    cancelledTasks?: number | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface TopOrderedProduct {
  name: string;
  quantity: number;
}

export interface DashboardRecentEnquiry {
  id: string;
  displayName: string;
  customerCode?: string | null;
  status: string;
  stage: 'converted' | 'pending';
  workOrderNumber?: string | null;
  createdAt?: string | null;
}

export interface DashboardRecentQuote {
  id: string;
  quoteNumber: string;
  customerDisplayName?: string | null;
  customerCode?: string | null;
  status: string;
  grandTotal: number;
  quoteDate?: string | null;
  createdAt?: string | null;
}

export interface DashboardRecentInvoice {
  id: string;
  invoiceNumber: string;
  customerDisplayName?: string | null;
  customerCode?: string | null;
  quoteNumberRef?: string | null;
  status: string;
  grandTotal: number;
  balanceAmount: number;
  invoiceDate?: string | null;
  dueDate?: string | null;
  createdAt?: string | null;
}

export interface DashboardRecentPayment {
  id: string;
  paymentNumber: string;
  customerDisplayName?: string | null;
  customerCode?: string | null;
  invoiceNumberRef?: string | null;
  status: string;
  amount: number;
  paymentDate?: string | null;
  createdAt?: string | null;
}

export interface BusinessDashboardSummary {
  range: {
    period: DashboardPeriod;
    from: string;
    to: string;
  };
  businessSummary: {
    customerEnquiries: number;
    workOrders: number;
    quotes: number;
    invoices: number;
    payments: number;
    grossSales: number;
    collectedAmount: number;
  };
  salesPipeline: {
    enquiries: number;
    workOrders: number;
    quotes: number;
    invoices: number;
    payments: number;
  };
  quoteOverview: {
    totalQuotes: number;
    draftQuotes: number;
    sentQuotes: number;
    acceptedQuotes: number;
    declinedQuotes: number;
    expiredQuotes: number;
    totalQuoteValue: number;
  };
  invoiceOverview: {
    totalInvoices: number;
    draftInvoices: number;
    sentInvoices: number;
    partiallyPaidInvoices: number;
    paidInvoices: number;
    overdueInvoices: number;
    voidInvoices: number;
    totalInvoiceValue: number;
  };
  paymentOverview: {
    paidInvoicesOrOrders: number;
    pendingInvoicesOrOrders: number;
    totalPayments: number;
    pendingPayments: number;
    successPayments: number;
    failedPayments: number;
    refundedPayments: number;
    totalPaymentAmount: number;
    collectedAmount: number;
    outstandingAmount: number;
  };
  orderInsights: {
    totalItemQuantitySold: number;
    averageOrderValue: number;
    highestOrderValue: number;
    topOrderedProducts: TopOrderedProduct[];
  };
  enquiryConversion: {
    enquiriesReceived: number;
    workOrdersCreated: number;
    conversionRate: number;
    pendingEnquiries: number;
  };
  funnelConversion: {
    enquiryToWorkOrderRate: number;
    workOrderToQuoteRate: number;
    quoteToInvoiceRate: number;
    invoiceToPaidRate: number;
  };
  recentActivity: {
    enquiries: DashboardRecentEnquiry[];
    quotes: DashboardRecentQuote[];
    invoices: DashboardRecentInvoice[];
    payments: DashboardRecentPayment[];
  };
  trend: {
    granularity: 'hour' | 'day';
    points: Array<{
      label: string;
      enquiries: number;
      workOrders: number;
      collectedAmount: number;
    }>;
  };
}

export interface MasterDataTier {
  id: string;
  tierKey: string;
  tierName: string;
  multiplier: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerZohoSyncSummary {
  totalCustomers: number;
  syncedCount: number;
  failedCount: number;
  pendingCount: number;
  lastOverallSyncedAt?: string | null;
}

export interface QuoteZohoSyncSummary {
  totalQuotes: number;
  syncedCount: number;
  failedCount: number;
  pendingCount: number;
  lastOverallSyncedAt?: string | null;
}

export interface InvoiceZohoSyncSummary {
  totalInvoices: number;
  syncedCount: number;
  failedCount: number;
  pendingCount: number;
  lastOverallSyncedAt?: string | null;
}

export interface PaymentZohoSyncSummary {
  totalPayments: number;
  syncedCount: number;
  failedCount: number;
  pendingCount: number;
  lastOverallSyncedAt?: string | null;
}

export interface AdminCalendarEvent {
  id: string;
  entityId: string;
  eventType: 'customer_enquiry' | 'work_order_conversion';
  title: string;
  subtitle?: string | null;
  startAt?: string | null;
  status?: string | null;
  amount?: number | null;
  orderReferenceNumber?: string | null;
  customerId?: string | null;
}

export interface AdminCalendarResponse {
  range: {
    from: string;
    to: string;
  };
  summary: {
    totalEnquiries: number;
    totalConversions: number;
  };
  events: AdminCalendarEvent[];
}

export interface AdminCalendarWorkOrderDetails {
  workOrder: MasterDataWorkOrder & {
    quotePdf?: {
      url: string;
      fileName?: string | null;
    } | null;
    invoicePdf?: {
      url: string;
      fileName?: string | null;
    } | null;
  };
  customer: MasterDataCustomer | null;
  quote: MasterDataQuote | null;
  invoice: MasterDataInvoice | null;
  payments: MasterDataPayment[];
  summary: {
    totalAmount?: number | null;
    balanceAmount?: number | null;
    paymentStatus?: string | null;
    totalProducts?: number | null;
  };
}

export interface ProductUploadResult {
  mode?: 'merge' | 'replace';
  importedCount?: number;
  skippedCount?: number;
  failedCount?: number;
  retiredCount?: number;
  inferredDimensionCount?: number;
  failures?: Array<{ rowNumber: number; sku?: string | null; message: string }>;
  warnings?: Array<{ rowNumber: number; sku?: string | null; type?: string | null; message: string }>;
  importBatchId?: string | null;
  sourceFileName?: string | null;
  storedFileName?: string | null;
  relativeFilePath?: string | null;
}

export interface CustomerHistoryContext {
  customerId?: string | null;
  cybotUserId?: string | null;
  customerCode?: string | null;
  displayName?: string | null;
}

export interface CustomerHistoryOrderItem {
  name: string;
  quantity: number;
}

export interface CustomerHistoryQuoteSummary {
  quoteNumber?: string | null;
  status?: string | null;
  quoteDate?: string | null;
  expiryDate?: string | null;
  accepted: boolean;
  acceptedAt?: string | null;
  grandTotal?: number | null;
  pdf?: {
    url: string;
    fileName?: string | null;
  } | null;
}

export interface CustomerHistoryInvoiceSummary {
  invoiceNumber?: string | null;
  status?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  grandTotal?: number | null;
  paidAmount?: number | null;
  balanceAmount?: number | null;
  pdf?: {
    url: string;
    fileName?: string | null;
  } | null;
}

export interface CustomerHistoryPaymentSummary {
  paymentNumber?: string | null;
  paymentDate?: string | null;
  amount?: number | null;
  paymentMode?: string | null;
  status?: string | null;
  referenceNumber?: string | null;
  gatewayProvider?: string | null;
}

export interface CustomerHistoryOrderRecord {
  latestActivityAt?: string | null;
  requestedAt?: string | null;
  orderReferenceNumber?: string | null;
  status?: string | null;
  paymentStatus?: string | null;
  deliveryMode?: string | null;
  items: CustomerHistoryOrderItem[];
  quote?: CustomerHistoryQuoteSummary | null;
  invoice?: CustomerHistoryInvoiceSummary | null;
  payments: CustomerHistoryPaymentSummary[];
}

export interface CustomerHistoryResponse {
  customer: {
    id: string;
    displayName: string;
    customerCode?: string | null;
    companyName?: string | null;
    email?: string | null;
    phone?: string | null;
    cybotUserId?: string | null;
  };
  context: CustomerHistoryContext;
  history: CustomerHistoryOrderRecord[];
}

export interface InventorySummary {
  totalProducts: number;
  activeProducts: number;
  inactiveProducts: number;
  lastImportedAt?: string | null;
  lastSourceFileName?: string | null;
  lastImportMode?: 'merge' | 'replace' | null;
  lastImportBatchId?: string | null;
}

export interface InventoryImportHistoryItem {
  id: string;
  importBatchId: string;
  sourceFileName: string;
  storedFileName?: string | null;
  relativeFilePath?: string | null;
  mode: 'merge' | 'replace';
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  retiredCount?: number;
  inferredDimensionCount?: number;
  failures: Array<{ rowNumber: number; sku?: string | null; message: string }>;
  warnings?: Array<{ rowNumber: number; sku?: string | null; type?: string | null; message: string }>;
  createdAt: string;
}

export interface MasterDataInventoryProduct {
  id: string;
  sku: string;
  itemName: string;
  category: string;
  description?: string | null;
  finish?: string | null;
  salesPrice?: number | null;
  qtyAvailable?: number | null;
  unit?: string | null;
  generalSku?: string | null;
  style?: string | null;
  width?: number | null;
  height?: number | null;
  depth?: number | null;
  purchasePrice?: number | null;
  isActive: boolean;
  leadTimeDays?: number | null;
  notes?: string | null;
  imageUrl?: string | null;
  sourceFileName?: string | null;
  importBatchId?: string | null;
  lastImportedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MasterDataQuote {
  id: string;
  quoteNumber: string;
  customerId: string;
  customerDisplayName?: string;
  customerCode?: string | null;
  quoteDate: string;
  expiryDate?: string | null;
  lineItems: LineItemValue[];
  subTotal: number;
  taxTotal: number;
  discountTotal: number;
  grandTotal: number;
  status: 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';
  notes?: string | null;
  termsAndConditions?: string | null;
  zohoEstimateId?: string | null;
  zohoSyncStatus: 'not_synced' | 'synced' | 'failed';
  zohoLastSyncedAt?: string | null;
  zohoErrorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MasterDataInvoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerDisplayName?: string;
  customerCode?: string | null;
  quoteId?: string | null;
  quoteNumberRef?: string;
  invoiceDate: string;
  dueDate: string;
  lineItems: LineItemValue[];
  subTotal: number;
  taxTotal: number;
  discountTotal: number;
  grandTotal: number;
  paidAmount: number;
  balanceAmount: number;
  status: 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'void';
  notes?: string | null;
  termsAndConditions?: string | null;
  zohoInvoiceId?: string | null;
  zohoSyncStatus: 'not_synced' | 'synced' | 'failed';
  zohoLastSyncedAt?: string | null;
  zohoErrorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MasterDataPayment {
  id: string;
  paymentNumber: string;
  customerId: string;
  customerDisplayName?: string;
  customerCode?: string | null;
  invoiceId: string;
  invoiceNumberRef?: string;
  paymentDate: string;
  amount: number;
  paymentMode: 'cash' | 'bank_transfer' | 'upi' | 'card' | 'cheque' | 'payment_gateway';
  referenceNumber?: string | null;
  gatewayProvider?: string | null;
  gatewayPaymentId?: string | null;
  paymentLink?: string | null;
  status: 'pending' | 'success' | 'failed' | 'refunded';
  notes?: string | null;
  zohoPaymentId?: string | null;
  zohoSyncStatus: 'not_synced' | 'synced' | 'failed';
  zohoLastSyncedAt?: string | null;
  zohoErrorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

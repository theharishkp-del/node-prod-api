import { AddressValue } from '../address-picker/address-picker';

export interface BotMasterKeyValue {
  databaseName?: string;
  botId?: string | number;
  userId?: string | number;
  companyName?: string;
  [key: string]: string | number | boolean | null | undefined;
}

export interface PlanConfig {
  planCode: string;
  planName: string;
  limits: {
    minAdmins: number;
    minTechnicians: number;
    maxUsers: number;
  };
}

export interface CompanyDetailsValue {
  companyName: string;
  businessEmail: string;
  countryCode: string;
  phoneNumber: string;
  address: AddressValue;
  website: string;
  currency: string;
  timezone: string;
}

export interface BranchValue {
  branchId?: string;
  branchName: string;
  address: AddressValue;
}

export interface CybotUserRegistrationValue {
  firstName: string;
  lastName: string;
  uniqueName: string;
  userName: string;
  id: string;
  emailId: string;
  phoneNumber: string;
  countryCode: string;
  role: 'Admin' | 'Technician';
}

export interface CybotUserLookupPayload {
  botMasterKey?: BotMasterKeyValue | null;
  databaseName?: string;
  userId?: string;
  emailId?: string;
  countryCode?: string;
  phoneNumber?: string;
}

export interface CybotUserLookupResponse {
  status: 'ok' | 'not_found';
  message: string;
  requestPayload: {
    databaseName: string;
    userId?: string;
    emailId?: string;
  };
  userDetails?: Omit<CybotUserRegistrationValue, 'role'>;
}

export interface ZohoAccessibleOrganization {
  organizationId: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  currencyCode?: string | null;
  timeZone?: string | null;
}

export interface ZohoIntegrationStatusResponse {
  status: 'ok';
  connected: boolean;
  autoSyncEnabled?: boolean;
  organizationId?: string | null;
  organizationName?: string | null;
  selectedOrganizationId?: string | null;
  selectedOrganizationName?: string | null;
  accessibleOrganizations?: ZohoAccessibleOrganization[];
  selectionRequired?: boolean;
  organizationLocked?: boolean;
  connectedAt?: string | null;
  scope?: string | null;
  accessTokenExpiresAt?: string | null;
  initialImport?: ZohoInitialImportState | null;
  authorizeUrl: string;
}

export interface CompleteOnboardingPayload {
  botMasterKey: BotMasterKeyValue;
  companyDetails: CompanyDetailsValue;
  branches: BranchValue[];
  cybotUsers: CybotUserRegistrationValue[];
}

export interface CompleteOnboardingResponse {
  status: 'created' | 'updated';
  message: string;
  tenantId: string;
  tenantDatabase: string;
  customerId: string;
}

export interface ExistingOnboardingResponse {
  status: 'ok' | 'not_found';
  message: string;
  editMode: boolean;
  tenantId?: string;
  tenantDatabase?: string;
  customerId?: string;
  planConfig?: PlanConfig;
  payload?: CompleteOnboardingPayload;
}

export interface ZohoOrganizationSelectionResponse {
  status: 'ok';
  message: string;
  organizationId: string;
  organizationName: string;
  initialImport?: ZohoInitialImportState | null;
}

export interface ZohoAutoSyncUpdateResponse {
  status: 'ok';
  message: string;
  connected: boolean;
  autoSyncEnabled: boolean;
  organizationId?: string | null;
  organizationName?: string | null;
}

export interface ZohoInitialImportModuleState {
  key: string;
  label: string;
  status: string;
  fetchedCount: number;
  importedCount: number;
  startedAt?: string | null;
  completedAt?: string | null;
  lastError?: string | null;
}

export interface ZohoInitialImportState {
  status: string;
  startedAt?: string | null;
  completedAt?: string | null;
  lastError?: string | null;
  modules: ZohoInitialImportModuleState[];
}

export interface MasterDataModuleOverview {
  moduleKey: string;
  label: string;
  status: string;
  recordsInMongo: number;
  lastSyncedAt?: string | null;
  lastSyncStartedAt?: string | null;
  lastSyncFinishedAt?: string | null;
  lastError?: string | null;
}

export interface MasterDataRecord {
  [key: string]: unknown;
}

export interface MasterDataOverviewResponse {
  status: 'ok';
  tenant: {
    botUserId: string;
    tenantId?: string | null;
    databaseName?: string | null;
    companyName?: string | null;
  };
  zohoConnection: {
    connected: boolean;
    organizationId?: string | null;
    organizationName?: string | null;
    connectedAt?: string | null;
  };
  modules: MasterDataModuleOverview[];
}

export interface MasterDataSyncResponse {
  status: 'ok';
  moduleKey: string;
  label: string;
  statusText?: string;
  recordsFetched: number;
  recordsStored: number;
  recordsInMongo: number;
  records: MasterDataRecord[];
}

export interface OnboardingCompletionState {
  operation: 'created' | 'updated';
  message: string;
}

export interface ApiRequestPreview {
  method: 'POST';
  url: string;
  body: CompleteOnboardingPayload;
}

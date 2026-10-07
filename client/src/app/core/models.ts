/**
 * @file TypeScript models mirroring the admin API payloads.
 */
/** API models of the admin API (/api/admin). */

export type OrgStatus = 'active' | 'suspended';
export type BotStatus = 'active' | 'inactive';

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
}

export interface Organization {
  _id: string;
  orgId: string;
  name: string;
  legalName?: string;
  email?: string;
  phone?: string;
  address?: Address;
  currencyCode: string;
  timezone: string;
  logoUrl?: string;
  dbName: string;
  status: OrgStatus;
  settings?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  botCount?: number;
  activeBotCount?: number;
  sessionCount?: number;
}

export type OrganizationInput = Partial<
  Pick<Organization, 'orgId' | 'name' | 'legalName' | 'email' | 'phone' | 'address' | 'currencyCode' | 'timezone' | 'logoUrl' | 'settings'>
>;

export interface OrgSummary {
  orgId: string;
  name: string;
  status: OrgStatus;
}

export interface Bot {
  _id: string;
  botUserId: string;
  botDatabaseName?: string;
  name: string;
  orgId: string;
  channel: string;
  status: BotStatus;
  config?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  organization?: OrgSummary | null;
}

export type BotInput = Partial<Pick<Bot, 'botUserId' | 'name' | 'orgId' | 'botDatabaseName' | 'channel' | 'status' | 'config'>>;

export interface EoMessage {
  direction: 'in' | 'out';
  signalId?: string;
  parentId?: string;
  questionKey?: string;
  answerKey?: string;
  expectedAns?: string;
  answerText?: string;
  mimeType?: string;
  eoState?: string;
  resultCode?: string;
  resultText?: string;
  at: string;
}

export interface EoSession {
  _id: string;
  sessionDate: string;
  botUserId: string;
  botDatabaseName?: string;
  taskId: string;
  taskNo?: string;
  fromId?: string;
  toId?: string;
  fromEmail?: string;
  deviceId?: string;
  env?: string;
  localTimeZone?: string;
  databaseName?: string;
  createdDate?: string;
  firstMessageAt?: string;
  lastMessageAt?: string;
  messageCount?: number;
  lastEoState?: string;
  messages?: EoMessage[];
  lastMessage?: Pick<EoMessage, 'direction' | 'answerText' | 'eoState' | 'at'> | null;
  org?: { orgId: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface OrgStatsRow {
  orgId: string;
  name: string;
  status: OrgStatus;
  bots: number;
  activeBots: number;
  sessions: number;
  sessionsLast24h: number;
  lastMessageAt: string | null;
}

export interface AdminStats {
  organizations: { total: number; active: number; suspended: number };
  bots: { total: number; active: number; inactive: number };
  sessions: { total: number; last24h: number };
  perOrganization: OrgStatsRow[];
  perOrganizationTruncated: boolean;
  generatedAt: string;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: PageMeta;
}

export interface Page<T> {
  items: T[];
  meta: PageMeta;
}

export interface ApiErrorBody {
  error?: { message?: string; code?: string; details?: { path: string; message: string }[] };
}

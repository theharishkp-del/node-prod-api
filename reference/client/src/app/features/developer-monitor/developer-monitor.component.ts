import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { finalize } from 'rxjs';
import { TrialBotManagementComponent } from '../trial-bot-management/trial-bot-management.component';
import { DeveloperMonitorService } from './developer-monitor.service';
import {
  DeveloperCollectionPreview,
  DeveloperCollectionSummary,
  DeveloperLogEntry,
  DeveloperMonitorOverview,
  DeveloperMonitorScope,
} from '../master-data/shared/master-data.types';

const DEVELOPER_MONITOR_STORAGE_KEY = 'developerMonitorKey';

@Component({
  selector: 'app-developer-monitor',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, TrialBotManagementComponent],
  templateUrl: './developer-monitor.component.html',
  styleUrl: './developer-monitor.component.css',
})
export class DeveloperMonitorComponent {
  readonly logLevels = ['ALL', 'INFO', 'WARN', 'ERROR', 'DEBUG', 'HTTP'];
  readonly previewLimits = [5, 10, 15, 25];
  readonly maxLogDate = this.getCurrentDateInputValue();

  overview: DeveloperMonitorOverview | null = null;
  recentLogs: DeveloperLogEntry[] = [];
  collectionPreview: DeveloperCollectionPreview | null = null;

  loadingOverview = false;
  loadingLogs = false;
  loadingPreview = false;
  deletingCollections = false;
  savingDocument = false;
  creatingCollection = false;

  overviewErrorMessage = '';
  logsErrorMessage = '';
  previewErrorMessage = '';
  deleteErrorMessage = '';
  deleteSuccessMessage = '';
  crudErrorMessage = '';
  crudSuccessMessage = '';

  logLevel = 'ALL';
  logSearch = '';
  logLimit = 40;
  logDate = this.maxLogDate;
  logView: 'all' | 'api' | 'application' = 'all';
  previewLimit = 10;
  requestTraceFilter = '';
  developerKey = '';
  selectedTenantId = '';
  activeMenu: 'database' | 'logs' | 'trial' = 'database';

  selectedScope: DeveloperMonitorScope | null = null;
  selectedCollectionName = '';
  selectedRequestId = '';
  selectedCollectionKeys = new Set<string>();
  deleteConfirmationText = '';
  createCollectionScope: DeveloperMonitorScope = 'tenant';
  newCollectionName = '';
  documentEditorMode: 'insert' | 'update' = 'insert';
  documentEditorId = '';
  documentEditorJson = '{\n  \n}';
  selectedRequestTrace: {
    requestId: string;
    method: string;
    url: string;
    route?: string;
    statusCode?: number;
    durationMs?: number;
    firstSeenAt?: string;
    lastSeenAt?: string;
    steps: Array<{ step: string; elapsedMs?: number; stage?: string; statusCode?: number; timestamp?: string }>;
  } | null = null;
  lastRefreshedAt = '';

  constructor(
    private readonly developerMonitorService: DeveloperMonitorService,
    private readonly changeDetectorRef: ChangeDetectorRef,
  ) {
    this.developerKey = this.getStoredDeveloperKey();
  }

  private getStoredDeveloperKey(): string {
    if (typeof sessionStorage === 'undefined') {
      return '';
    }

    return sessionStorage.getItem(DEVELOPER_MONITOR_STORAGE_KEY)?.trim() ?? '';
  }

  private persistDeveloperKey(): void {
    if (typeof sessionStorage === 'undefined') {
      return;
    }

    const trimmedKey = this.developerKey.trim();
    if (trimmedKey) {
      sessionStorage.setItem(DEVELOPER_MONITOR_STORAGE_KEY, trimmedKey);
      return;
    }

    sessionStorage.removeItem(DEVELOPER_MONITOR_STORAGE_KEY);
  }

  get masterCollections(): DeveloperCollectionSummary[] {
    return this.overview?.masterDatabase?.collections ?? [];
  }

  get tenantCollections(): DeveloperCollectionSummary[] {
    return this.overview?.tenantDatabase?.collections ?? [];
  }

  get visibleLogs(): DeveloperLogEntry[] {
    if (this.logView === 'all') return this.recentLogs;
    return this.recentLogs.filter((entry) => this.isApiLog(entry) === (this.logView === 'api'));
  }

  isApiLog(entry: DeveloperLogEntry): boolean {
    return !!entry['method'] && !!entry['url'];
  }

  getLogRequestId(entry: DeveloperLogEntry): string {
    return String(entry['requestId'] || '');
  }

  get selectedCollectionLabel(): string {
    if (!this.selectedScope || !this.selectedCollectionName) {
      return 'No collection selected';
    }

    return `${this.selectedScope === 'master' ? 'Master' : 'Tenant'} / ${this.selectedCollectionName}`;
  }

  get selectedCollectionsForDeletion(): Array<{ scope: DeveloperMonitorScope; name: string }> {
    return [...this.selectedCollectionKeys].map((key) => {
      const [scope, ...nameParts] = key.split(':');
      return { scope: scope as DeveloperMonitorScope, name: nameParts.join(':') };
    });
  }

  get selectedDeletionScope(): DeveloperMonitorScope | null {
    const scopes = new Set(this.selectedCollectionsForDeletion.map((collection) => collection.scope));
    return scopes.size === 1 ? [...scopes][0] : null;
  }

  get canDeleteSelectedCollections(): boolean {
    return !!this.selectedDeletionScope
      && this.selectedCollectionsForDeletion.length > 0
      && this.getConfirmationNames().length === this.selectedCollectionsForDeletion.length
      && this.getConfirmationNames().every((name) => this.selectedCollectionsForDeletion.some((collection) => collection.name === name));
  }

  loadOverview(): void {
    const trimmedKey = this.developerKey.trim();
    if (!trimmedKey) {
      this.overviewErrorMessage = 'Enter the developer monitor key to access database diagnostics.';
      return;
    }

    this.developerKey = trimmedKey;
    this.persistDeveloperKey();

    this.loadingOverview = true;
    this.overviewErrorMessage = '';

    this.developerMonitorService.getOverview({
      developerKey: this.developerKey,
      tenantId: this.selectedTenantId || undefined,
      logLimit: this.logLimit,
      logLevel: this.logLevel,
      logSearch: this.logSearch,
      logDate: this.logDate,
    })
      .pipe(finalize(() => {
        this.loadingOverview = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          this.overview = response.data;
          this.selectedTenantId = response.data.tenantContext.tenantId || '';
          this.recentLogs = response.data.recentLogs ?? [];
          this.logDate = response.data.logConfig?.activeDate || this.logDate;
          this.lastRefreshedAt = response.data.generatedAt || new Date().toISOString();
          this.removeMissingDeleteSelections();

          const nextSelection = this.resolveSelectionAfterRefresh();
          if (nextSelection) {
            this.selectCollection(nextSelection.scope, nextSelection.collectionName, false);
            return;
          }

          this.selectedScope = null;
          this.selectedCollectionName = '';
          this.collectionPreview = null;
        },
        error: (error) => {
          this.overviewErrorMessage = error?.error?.message || 'Failed to load developer monitor overview.';
        },
      });
  }

  refreshLogs(): void {
    if (!this.developerKey.trim()) {
      this.logsErrorMessage = 'Enter the developer monitor key first.';
      return;
    }

    this.loadingLogs = true;
    this.logsErrorMessage = '';

    this.developerMonitorService.getLogs({
      developerKey: this.developerKey,
      limit: this.logLimit,
      level: this.logLevel,
      search: this.logSearch,
      date: this.logDate,
      kind: this.logView === 'all' ? undefined : this.logView,
    })
      .pipe(finalize(() => {
        this.loadingLogs = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          this.recentLogs = response.data.items ?? [];
          this.logDate = response.data.selectedDate || this.logDate;

          if (this.overview) {
            this.overview = {
              ...this.overview,
              logConfig: {
                ...this.overview.logConfig,
                availableCount: response.data.totalAvailable,
                returnedCount: response.data.returnedCount,
                activeLevelFilter: this.logLevel,
                activeSearch: this.logSearch,
                activeDate: response.data.selectedDate,
                source: response.data.source,
              },
            };
          }
        },
        error: (error) => {
          this.logsErrorMessage = error?.error?.message || 'Failed to refresh logs.';
        },
      });
  }

  showLogs(level = this.logLevel): void {
    this.activeMenu = 'logs';
    this.logLevel = level;
    this.refreshLogs();
  }

  setLogView(view: 'all' | 'api' | 'application'): void {
    this.logView = view;
    this.refreshLogs();
  }

  selectCollection(scope: DeveloperMonitorScope, collectionName: string, fromUser = true): void {
    if (!collectionName || !this.selectedTenantId || !this.developerKey.trim()) {
      return;
    }

    this.selectedScope = scope;
    this.selectedCollectionName = collectionName;
    this.previewErrorMessage = '';

    if (fromUser) {
      this.collectionPreview = null;
    }

    this.loadingPreview = true;

    this.developerMonitorService.getCollectionPreview(this.developerKey, this.selectedTenantId, scope, collectionName, this.previewLimit)
      .pipe(finalize(() => {
        this.loadingPreview = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          this.collectionPreview = response.data;
        },
        error: (error) => {
          this.previewErrorMessage = error?.error?.message || 'Failed to load collection preview.';
        },
      });
  }

  refreshSelectedCollection(): void {
    if (!this.selectedScope || !this.selectedCollectionName) {
      return;
    }

    this.selectCollection(this.selectedScope, this.selectedCollectionName, false);
  }

  isCollectionSelected(scope: DeveloperMonitorScope, collectionName: string): boolean {
    return this.selectedScope === scope && this.selectedCollectionName === collectionName;
  }

  isCollectionMarkedForDeletion(scope: DeveloperMonitorScope, collectionName: string): boolean {
    return this.selectedCollectionKeys.has(this.getCollectionKey(scope, collectionName));
  }

  toggleCollectionForDeletion(scope: DeveloperMonitorScope, collectionName: string, checked: boolean): void {
    const key = this.getCollectionKey(scope, collectionName);
    if (checked) {
      this.selectedCollectionKeys.add(key);
    } else {
      this.selectedCollectionKeys.delete(key);
    }
    this.selectedCollectionKeys = new Set(this.selectedCollectionKeys);
    this.deleteConfirmationText = '';
    this.deleteErrorMessage = '';
    this.deleteSuccessMessage = '';
  }

  prepareSelectedCollectionForDeletion(): void {
    if (!this.selectedScope || !this.selectedCollectionName) return;
    this.selectedCollectionKeys = new Set([this.getCollectionKey(this.selectedScope, this.selectedCollectionName)]);
    this.deleteConfirmationText = '';
    this.deleteErrorMessage = '';
    this.deleteSuccessMessage = '';
  }

  toggleScopeCollections(scope: DeveloperMonitorScope, checked: boolean): void {
    const collections = scope === 'master' ? this.masterCollections : this.tenantCollections;
    for (const collection of collections) {
      const key = this.getCollectionKey(scope, collection.name);
      if (checked) this.selectedCollectionKeys.add(key);
      else this.selectedCollectionKeys.delete(key);
    }
    this.selectedCollectionKeys = new Set(this.selectedCollectionKeys);
    this.deleteConfirmationText = '';
    this.deleteErrorMessage = '';
    this.deleteSuccessMessage = '';
  }

  isScopeMarkedForDeletion(scope: DeveloperMonitorScope): boolean {
    const collections = scope === 'master' ? this.masterCollections : this.tenantCollections;
    return collections.length > 0 && collections.every((collection) => this.isCollectionMarkedForDeletion(scope, collection.name));
  }

  deleteSelectedCollections(): void {
    const scope = this.selectedDeletionScope;
    const selectedCollections = this.selectedCollectionsForDeletion;
    if (!scope || !selectedCollections.length) {
      this.deleteErrorMessage = 'Select collections from one database scope before deleting.';
      return;
    }
    if (!this.canDeleteSelectedCollections) {
      this.deleteErrorMessage = 'Type every selected collection name exactly, separated by commas or new lines.';
      return;
    }

    this.deletingCollections = true;
    this.deleteErrorMessage = '';
    this.deleteSuccessMessage = '';
    const collectionNames = selectedCollections.map((collection) => collection.name);
    this.developerMonitorService.deleteCollections(this.developerKey, this.selectedTenantId, scope, collectionNames, this.getConfirmationNames())
      .pipe(finalize(() => {
        this.deletingCollections = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          this.selectedCollectionKeys = new Set();
          this.deleteConfirmationText = '';
          this.deleteSuccessMessage = `${response.data.deletedCollectionNames.length} collection(s) deleted from ${response.data.databaseName}.`;
          this.selectedScope = null;
          this.selectedCollectionName = '';
          this.collectionPreview = null;
          this.loadOverview();
        },
        error: (error) => {
          this.deleteErrorMessage = error?.error?.message || 'Failed to delete the selected collections.';
        },
      });
  }

  createCollection(): void {
    const name = this.newCollectionName.trim();
    if (!name || !this.developerKey.trim() || !this.selectedTenantId) {
      this.crudErrorMessage = 'Enter a collection name and connect to Developer Monitor first.';
      return;
    }
    this.creatingCollection = true;
    this.crudErrorMessage = '';
    this.developerMonitorService.createCollection(this.developerKey, this.selectedTenantId, this.createCollectionScope, name)
      .pipe(finalize(() => { this.creatingCollection = false; this.changeDetectorRef.detectChanges(); }))
      .subscribe({
        next: () => { this.crudSuccessMessage = `Collection "${name}" created.`; this.newCollectionName = ''; this.loadOverview(); },
        error: (error) => { this.crudErrorMessage = error?.error?.message || 'Failed to create collection.'; },
      });
  }

  startInsertDocument(): void {
    this.documentEditorMode = 'insert';
    this.documentEditorId = '';
    this.documentEditorJson = '{\n  \n}';
    this.crudErrorMessage = '';
  }

  startUpdateDocument(document: Record<string, unknown>): void {
    const documentId = String(document['_id'] || '');
    if (!documentId) return;
    const { _id, ...editableDocument } = document;
    this.documentEditorMode = 'update';
    this.documentEditorId = documentId;
    this.documentEditorJson = JSON.stringify(editableDocument, null, 2);
    this.crudErrorMessage = '';
  }

  saveDocument(): void {
    if (!this.selectedScope || !this.selectedCollectionName) {
      this.crudErrorMessage = 'Select a collection first.';
      return;
    }
    let document: Record<string, unknown>;
    try {
      const parsed = JSON.parse(this.documentEditorJson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      document = parsed;
    } catch {
      this.crudErrorMessage = 'Enter valid JSON object data.';
      return;
    }
    this.savingDocument = true;
    this.crudErrorMessage = '';
    const request = this.documentEditorMode === 'insert'
      ? this.developerMonitorService.insertDocument(this.developerKey, this.selectedTenantId, this.selectedScope, this.selectedCollectionName, document)
      : this.developerMonitorService.updateDocument(this.developerKey, this.selectedTenantId, this.selectedScope, this.selectedCollectionName, this.documentEditorId, document);
    request.pipe(finalize(() => { this.savingDocument = false; this.changeDetectorRef.detectChanges(); }))
      .subscribe({
        next: () => { this.crudSuccessMessage = this.documentEditorMode === 'insert' ? 'Document inserted.' : 'Document updated.'; this.refreshSelectedCollection(); },
        error: (error) => { this.crudErrorMessage = error?.error?.message || 'Failed to save document.'; },
      });
  }

  deleteDocument(document: Record<string, unknown>): void {
    const documentId = String(document['_id'] || '');
    if (!this.selectedScope || !this.selectedCollectionName || !documentId) return;
    if (!window.confirm(`Delete document ${documentId}? This cannot be undone.`)) return;
    this.savingDocument = true;
    this.crudErrorMessage = '';
    this.developerMonitorService.deleteDocument(this.developerKey, this.selectedTenantId, this.selectedScope, this.selectedCollectionName, documentId)
      .pipe(finalize(() => { this.savingDocument = false; this.changeDetectorRef.detectChanges(); }))
      .subscribe({
        next: () => { this.crudSuccessMessage = 'Document deleted.'; this.startInsertDocument(); this.refreshSelectedCollection(); },
        error: (error) => { this.crudErrorMessage = error?.error?.message || 'Failed to delete document.'; },
      });
  }

  getCollectionButtonClass(scope: DeveloperMonitorScope, collectionName: string): string {
    const isSelected = this.isCollectionSelected(scope, collectionName);
    const tone = scope === 'master'
      ? (isSelected ? 'developer-collection-button-selected-master' : 'developer-collection-button-master')
      : (isSelected ? 'developer-collection-button-selected-tenant' : 'developer-collection-button-tenant');

    return `developer-collection-button ${tone}`;
  }

  openTrialBotManagement(): void {
    if (!this.developerKey.trim()) {
      this.overviewErrorMessage = 'Enter the developer monitor key before opening Trial Bot Management.';
      return;
    }

    this.activeMenu = 'trial';
  }

  closeTrialBotManagement(): void {
    this.activeMenu = 'database';
  }

  getLogLevelClass(level: string): string {
    switch (String(level || '').toUpperCase()) {
      case 'ERROR':
        return 'developer-log-level developer-log-level-error';
      case 'WARN':
        return 'developer-log-level developer-log-level-warn';
      case 'DEBUG':
        return 'developer-log-level developer-log-level-debug';
      case 'HTTP':
        return 'developer-log-level developer-log-level-http';
      default:
        return 'developer-log-level developer-log-level-info';
    }
  }

  get requestTimeline(): Array<{
    requestId: string;
    method: string;
    url: string;
    route?: string;
    statusCode?: number;
    durationMs?: number;
    latestLevel: string;
    latestMessage: string;
    firstSeenAt?: string;
    lastSeenAt?: string;
    steps: Array<{ step: string; elapsedMs?: number; stage?: string; statusCode?: number; timestamp?: string }>;
  }> {
    const filteredEntries = this.recentLogs.filter((entry) => {
      const entryRecord = entry as Record<string, unknown>;
      const requestId = String(entryRecord['requestId'] || '').trim();
      if (!requestId) {
        return false;
      }

      if (!this.requestTraceFilter.trim()) {
        return true;
      }

      const needle = this.requestTraceFilter.trim().toLowerCase();
      const searchable = [
        requestId,
        entry.message || '',
        entry.level || '',
        String(entryRecord['method'] || ''),
        String(entryRecord['url'] || ''),
        String(entryRecord['route'] || ''),
      ].join(' ').toLowerCase();
      return searchable.includes(needle);
    });

    const grouped = new Map<string, {
      requestId: string;
      method: string;
      url: string;
      route?: string;
      statusCode?: number;
      durationMs?: number;
      latestLevel: string;
      latestMessage: string;
      firstSeenAt?: string;
      lastSeenAt?: string;
      steps: Array<{ step: string; elapsedMs?: number; stage?: string; statusCode?: number; timestamp?: string }>;
    }>();

    for (const entry of filteredEntries) {
      const requestId = String(entry.requestId || '').trim();
      if (!requestId) {
        continue;
      }

      const current = grouped.get(requestId) ?? {
        requestId,
        method: String((entry as any).method || 'UNKNOWN'),
        url: String((entry as any).url || (entry as any).route || 'unknown'),
        route: String((entry as any).route || (entry as any).url || ''),
        latestLevel: String(entry.level || 'INFO').toUpperCase(),
        latestMessage: String(entry.message || 'request log'),
        steps: [],
      };

      const entryRecord = entry as Record<string, unknown>;

      if (entryRecord['method']) {
        current.method = String(entryRecord['method']);
      }
      if (entryRecord['url']) {
        current.url = String(entryRecord['url']);
      }
      if (entryRecord['route']) {
        current.route = String(entryRecord['route']);
      }
      if (entryRecord['statusCode'] !== undefined) {
        current.statusCode = Number(entryRecord['statusCode']);
      }
      if (entryRecord['durationMs'] !== undefined) {
        current.durationMs = Number(entryRecord['durationMs']);
      }
      if (entryRecord['step']) {
        current.steps.push({
          step: String(entryRecord['step']),
          elapsedMs: entryRecord['elapsedMs'] !== undefined ? Number(entryRecord['elapsedMs']) : undefined,
          stage: entryRecord['stage'] ? String(entryRecord['stage']) : undefined,
          statusCode: entryRecord['statusCode'] !== undefined ? Number(entryRecord['statusCode']) : undefined,
          timestamp: entry.timestamp,
        });
      }
      if (Array.isArray(entryRecord['requestFlow'])) {
        for (const step of entryRecord['requestFlow'] as Array<Record<string, unknown>>) {
          current.steps.push({
            step: String(step['step'] || 'unknown_step'),
            elapsedMs: step['elapsedMs'] !== undefined ? Number(step['elapsedMs']) : undefined,
            stage: step['stage'] ? String(step['stage']) : undefined,
            statusCode: step['statusCode'] !== undefined ? Number(step['statusCode']) : undefined,
            timestamp: entry.timestamp,
          });
        }
      }

      current.latestLevel = String(entry.level || current.latestLevel).toUpperCase();
      current.latestMessage = String(entry.message || current.latestMessage);
      current.firstSeenAt = current.firstSeenAt || entry.timestamp;
      current.lastSeenAt = entry.timestamp || current.lastSeenAt;
      grouped.set(requestId, current);
    }

    return [...grouped.values()]
      .filter((item) => item.requestId)
      .sort((a, b) => new Date(b.lastSeenAt || 0).getTime() - new Date(a.lastSeenAt || 0).getTime())
      .slice(0, 8);
  }

  clearRequestFilter(): void {
    this.requestTraceFilter = '';
    this.selectedRequestId = '';
    this.selectedRequestTrace = null;
  }

  showRequestTrace(requestId: string): void {
    this.selectedRequestId = requestId;
    const trace = this.requestTimeline.find((entry) => entry.requestId === requestId);
    if (!trace) {
      this.selectedRequestTrace = null;
      return;
    }

    const steps = trace.steps.length ? trace.steps : [{ step: trace.latestMessage, timestamp: trace.lastSeenAt }];
    this.selectedRequestTrace = {
      requestId: trace.requestId,
      method: trace.method,
      url: trace.url,
      route: trace.route,
      statusCode: trace.statusCode,
      durationMs: trace.durationMs,
      firstSeenAt: trace.firstSeenAt,
      lastSeenAt: trace.lastSeenAt,
      steps,
    };
  }

  getCollectionSampleKeys(collection: DeveloperCollectionSummary): string {
    return collection.sampleKeys?.length ? collection.sampleKeys.join(', ') : 'No sample document yet';
  }

  getLogSourceLabel(source: string | undefined): string {
    switch (source) {
      case 'memory-buffer':
        return 'Live memory buffer';
      case 'gz-archive':
        return 'Compressed archive file';
      case 'missing-file':
        return 'No log file found for this date';
      default:
        return 'Daily log file';
    }
  }

  formatJson(value: unknown): string {
    return JSON.stringify(value, null, 2);
  }

  formatLogMeta(entry: DeveloperLogEntry): string {
    const { timestamp, level, message, ...meta } = entry;
    return Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '{}';
  }

  trackByRequestId(_index: number, request: { requestId: string }): string {
    return request.requestId;
  }

  trackByCollectionName(_index: number, collection: DeveloperCollectionSummary): string {
    return collection.name;
  }

  trackByLogIndex(index: number): number {
    return index;
  }

  trackByDocumentIndex(index: number): number {
    return index;
  }

  private resolveSelectionAfterRefresh():
    { scope: DeveloperMonitorScope; collectionName: string } | null {
    if (this.selectedScope && this.selectedCollectionName && this.collectionExists(this.selectedScope, this.selectedCollectionName)) {
      return {
        scope: this.selectedScope,
        collectionName: this.selectedCollectionName,
      };
    }

    if (this.tenantCollections.length) {
      return {
        scope: 'tenant',
        collectionName: this.tenantCollections[0].name,
      };
    }

    if (this.masterCollections.length) {
      return {
        scope: 'master',
        collectionName: this.masterCollections[0].name,
      };
    }

    return null;
  }

  private collectionExists(scope: DeveloperMonitorScope, collectionName: string): boolean {
    const collections = scope === 'master' ? this.masterCollections : this.tenantCollections;
    return collections.some((collection) => collection.name === collectionName);
  }

  private getCollectionKey(scope: DeveloperMonitorScope, collectionName: string): string {
    return `${scope}:${collectionName}`;
  }

  private getConfirmationNames(): string[] {
    return [...new Set(this.deleteConfirmationText.split(/[\n,]+/).map((name) => name.trim()).filter(Boolean))];
  }

  private removeMissingDeleteSelections(): void {
    this.selectedCollectionKeys = new Set([...this.selectedCollectionKeys].filter((key) => {
      const [scope, ...nameParts] = key.split(':');
      return this.collectionExists(scope as DeveloperMonitorScope, nameParts.join(':'));
    }));
  }

  private getCurrentDateInputValue(): string {
    const now = new Date();
    const timezoneOffsetMs = now.getTimezoneOffset() * 60_000;
    return new Date(now.getTime() - timezoneOffsetMs).toISOString().slice(0, 10);
  }
}

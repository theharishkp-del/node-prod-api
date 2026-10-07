import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, NgZone, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { finalize } from 'rxjs';
import { AppDialogService } from '../../../services/app-dialog.service';
import { ProductUploadFormComponent } from './product-upload-form.component';
import { ProductUploadService } from './product-upload.service';
import {
  InventoryImportHistoryItem,
  InventorySummary,
  MasterDataFormMode,
  MasterDataInventoryProduct,
  PaginationState,
  ProductUploadResult,
} from '../shared/master-data.types';

@Component({
  selector: 'app-product-upload',
  standalone: true,
  imports: [CommonModule, FormsModule, ProductUploadFormComponent],
  templateUrl: './product-upload.component.html',
  styleUrl: './product-upload.component.css',
})
export class ProductUploadComponent implements OnInit {
  selectedFile: File | null = null;
  uploading = false;
  loading = false;
  saving = false;
  downloadingTemplate = false;
  deletingId = '';
  successMessage = '';
  errorMessage = '';
  formErrorMessage = '';
  importMode: 'merge' | 'replace' = 'merge';
  searchTerm = '';
  statusFilter = '';
  categoryFilter = '';
  categories: string[] = [];
  importHistory: InventoryImportHistoryItem[] = [];
  summary: InventorySummary | null = null;
  products: MasterDataInventoryProduct[] = [];
  formMode: MasterDataFormMode = 'create';
  selectedProduct: MasterDataInventoryProduct | null = null;
  formOpen = false;
  // image upload state: productId → uploading flag
  imageUploadingId = '';
  pagination: PaginationState = {
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  };

  constructor(
    private readonly appDialogService: AppDialogService,
    private readonly productUploadService: ProductUploadService,
    private readonly changeDetectorRef: ChangeDetectorRef,
    private readonly ngZone: NgZone,
  ) {}

  ngOnInit(): void {
    this.loadSummary();
    this.loadCategories();
    this.loadImportHistory();
    this.loadProducts();
  }

  get selectedFileName(): string {
    return this.selectedFile?.name || 'No file selected';
  }

  get selectedFileSizeLabel(): string {
    if (!this.selectedFile) {
      return '';
    }

    const sizeInMb = this.selectedFile.size / (1024 * 1024);
    return `${sizeInMb.toFixed(2)} MB`;
  }

  get hasProducts(): boolean {
    return this.products.length > 0;
  }

  get totalProducts(): number {
    return this.summary?.totalProducts ?? this.pagination.total ?? 0;
  }

  get activeProducts(): number {
    return this.summary?.activeProducts ?? 0;
  }

  get inactiveProducts(): number {
    return this.summary?.inactiveProducts ?? 0;
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
    this.successMessage = '';
    this.errorMessage = '';
    this.changeDetectorRef.detectChanges();
  }

  clearSelection(fileInput?: HTMLInputElement): void {
    this.selectedFile = null;
    if (fileInput) {
      fileInput.value = '';
    }
    this.changeDetectorRef.detectChanges();
  }

  uploadFile(fileInput: HTMLInputElement): void {
    if (!this.selectedFile || this.uploading) {
      return;
    }

    this.uploading = true;
    this.successMessage = '';
    this.errorMessage = '';
    this.changeDetectorRef.detectChanges();

    this.productUploadService.uploadInventoryFile(this.selectedFile, this.importMode)
      .pipe(finalize(() => {
        this.uploading = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: async (response) => {
          const result = (response?.data ?? null) as ProductUploadResult | null;
          this.ngZone.run(async () => {
            this.successMessage = this.buildUploadSuccessMessage(response?.message, result);
            this.clearSelection(fileInput);
            await this.refreshInventoryScreen(1);
          });
        },
        error: (error) => {
          this.ngZone.run(() => {
            this.errorMessage = error?.error?.message || 'Failed to upload inventory file.';
            this.changeDetectorRef.detectChanges();
          });
        },
      });
  }

  downloadTemplate(): void {
    if (this.downloadingTemplate) {
      return;
    }

    this.downloadingTemplate = true;
    this.errorMessage = '';

    this.productUploadService.downloadTemplate()
      .pipe(finalize(() => {
        this.downloadingTemplate = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = 'InventoryProduct.xlsx';
          anchor.click();
          URL.revokeObjectURL(url);
        },
        error: (error) => {
          this.errorMessage = error?.error?.message || 'Failed to download inventory template.';
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  loadSummary(): void {
    this.changeDetectorRef.detectChanges();
    this.productUploadService.getInventorySummary().subscribe({
      next: (response) => {
        this.summary = response?.data ?? null;
        this.changeDetectorRef.detectChanges();
      },
      error: () => {
        this.summary = null;
        this.changeDetectorRef.detectChanges();
      },
    });
  }

  loadCategories(): void {
    this.changeDetectorRef.detectChanges();
    this.productUploadService.listInventoryCategories().subscribe({
      next: (response) => {
        this.categories = Array.isArray(response?.data) ? response.data : [];
        this.changeDetectorRef.detectChanges();
      },
      error: () => {
        this.categories = [];
        this.changeDetectorRef.detectChanges();
      },
    });
  }

  loadImportHistory(): void {
    this.changeDetectorRef.detectChanges();
    this.productUploadService.listInventoryImportHistory(8).subscribe({
      next: (response) => {
        this.importHistory = Array.isArray(response?.data) ? response.data : [];
        this.changeDetectorRef.detectChanges();
      },
      error: () => {
        this.importHistory = [];
        this.changeDetectorRef.detectChanges();
      },
    });
  }

  loadProducts(page = this.pagination.page): void {
    this.loading = true;
    this.changeDetectorRef.detectChanges();
    this.productUploadService.listInventoryProducts({
      search: this.searchTerm || undefined,
      status: this.statusFilter || undefined,
      category: this.categoryFilter || undefined,
      page,
      pageSize: this.pagination.pageSize,
    })
      .pipe(finalize(() => {
        this.loading = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          this.products = Array.isArray(response?.data) ? response.data : [];
          if (response?.pagination) {
            this.pagination = response.pagination;
          }
          this.changeDetectorRef.detectChanges();
        },
        error: (error) => {
          this.products = [];
          this.errorMessage = error?.error?.message || 'Failed to load inventory products.';
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  onSearch(): void {
    this.loadProducts(1);
  }

  openCreate(): void {
    this.formMode = 'create';
    this.selectedProduct = null;
    this.formErrorMessage = '';
    this.formOpen = true;
  }

  openEdit(product: MasterDataInventoryProduct): void {
    this.formMode = 'edit';
    this.selectedProduct = product;
    this.formErrorMessage = '';
    this.formOpen = true;
  }

  openView(product: MasterDataInventoryProduct): void {
    this.formMode = 'view';
    this.selectedProduct = product;
    this.formErrorMessage = '';
    this.formOpen = true;
  }

  closeForm(): void {
    this.formOpen = false;
    this.selectedProduct = null;
    this.saving = false;
    this.formErrorMessage = '';
    this.changeDetectorRef.detectChanges();
  }

  onSave(payload: Partial<MasterDataInventoryProduct>): void {
    this.saving = true;
    this.formErrorMessage = '';

    const request$ = this.formMode === 'edit' && this.selectedProduct
      ? this.productUploadService.updateInventoryProduct(this.selectedProduct.id, payload)
      : this.productUploadService.createInventoryProduct(payload);

    request$
      .pipe(finalize(() => {
        this.saving = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          this.successMessage = response?.message
            || (this.formMode === 'edit' ? 'Inventory product updated successfully.' : 'Inventory product created successfully.');
          this.closeForm();
          this.loadSummary();
          this.loadCategories();
          this.loadProducts(this.formMode === 'create' ? 1 : this.pagination.page);
        },
        error: (error) => {
          this.formErrorMessage = error?.error?.message || 'Failed to save inventory product.';
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  onDelete(product: MasterDataInventoryProduct): void {
    if (this.deletingId) {
      return;
    }

    this.appDialogService.confirm({
      title: 'Delete Product',
      message: `Delete product "${product.itemName}"?`,
      buttonLabel: 'Delete',
      cancelLabel: 'Keep',
      onConfirm: () => {
        this.deletingId = product.id;
        this.errorMessage = '';
        this.successMessage = '';

        this.productUploadService.deleteInventoryProduct(product.id)
          .pipe(finalize(() => {
            this.deletingId = '';
            this.changeDetectorRef.detectChanges();
          }))
          .subscribe({
            next: (response) => {
              this.successMessage = response?.message || 'Inventory product deleted successfully.';
              this.loadSummary();
              this.loadCategories();
              this.loadProducts(this.pagination.page);
            },
            error: (error) => {
              this.errorMessage = error?.error?.message || 'Failed to delete inventory product.';
              this.changeDetectorRef.detectChanges();
            },
          });
      },
    });
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.pagination.totalPages || page === this.pagination.page) {
      return;
    }

    this.loadProducts(page);
  }

  trackByProductId(_index: number, product: MasterDataInventoryProduct): string {
    return product.id;
  }

  getRowNumber(index: number): number {
    return ((this.pagination.page - 1) * this.pagination.pageSize) + index + 1;
  }

  getStatusBadgeClass(product: MasterDataInventoryProduct): string {
    return product.isActive
      ? 'rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700'
      : 'rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700';
  }

  getImportModeLabel(mode: 'merge' | 'replace'): string {
    return mode === 'replace' ? 'Replace' : 'Merge';
  }

  onImageSelected(event: Event, product: MasterDataInventoryProduct): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || this.imageUploadingId) return;

    this.imageUploadingId = product.id;
    this.successMessage = '';
    this.errorMessage = '';
    this.changeDetectorRef.detectChanges();

    this.productUploadService.uploadProductImage(product.id, file)
      .pipe(finalize(() => {
        this.imageUploadingId = '';
        // Reset the input so the same file can be re-selected if needed
        input.value = '';
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          // Patch the imageUrl directly on the in-memory product so the table
          // updates immediately without a full reload.
          const found = this.products.find((p) => p.id === product.id);
          if (found) {
            found.imageUrl = response?.data?.imageUrl ?? null;
          }
          this.successMessage = `Image uploaded for ${product.sku}.`;
          this.changeDetectorRef.detectChanges();
        },
        error: (error) => {
          this.errorMessage = error?.error?.message || 'Failed to upload product image.';
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  private buildUploadSuccessMessage(baseMessage: string | undefined, result: ProductUploadResult | null): string {
    const importedCount = Number(result?.importedCount ?? 0);
    const skippedCount = Number(result?.skippedCount ?? 0);
    const failedCount = Number(result?.failedCount ?? 0);
    const inferredDimensionCount = Number(result?.inferredDimensionCount ?? 0);
    const warningsCount = Array.isArray(result?.warnings) ? result!.warnings!.length : 0;
    const segments = [
      baseMessage || `Product upload completed successfully. Imported ${importedCount} records.`,
      `Imported: ${importedCount}`,
      `Skipped: ${skippedCount}`,
      `Failed: ${failedCount}`,
    ];

    if (inferredDimensionCount > 0 || warningsCount > 0) {
      segments.push(`Dimension inferred: ${inferredDimensionCount || warningsCount}`);
    }

    return segments.join(' ');
  }

  private async refreshInventoryScreen(page = this.pagination.page): Promise<void> {
    this.loading = true;
    this.changeDetectorRef.detectChanges();

    try {
      const [summaryResponse, categoriesResponse, historyResponse, productsResponse] = await Promise.all([
        firstValueFrom(this.productUploadService.getInventorySummary()),
        firstValueFrom(this.productUploadService.listInventoryCategories()),
        firstValueFrom(this.productUploadService.listInventoryImportHistory(8)),
        firstValueFrom(this.productUploadService.listInventoryProducts({
          search: this.searchTerm || undefined,
          status: this.statusFilter || undefined,
          category: this.categoryFilter || undefined,
          page,
          pageSize: this.pagination.pageSize,
        })),
      ]);

      this.summary = summaryResponse?.data ?? null;
      this.categories = Array.isArray(categoriesResponse?.data) ? categoriesResponse.data : [];
      this.importHistory = Array.isArray(historyResponse?.data) ? historyResponse.data : [];
      this.products = Array.isArray(productsResponse?.data) ? productsResponse.data : [];

      if (productsResponse?.pagination) {
        this.pagination = productsResponse.pagination;
      }
    } catch (error) {
      this.errorMessage = (error as { error?: { message?: string } })?.error?.message || 'Failed to refresh inventory data.';
    } finally {
      this.loading = false;
      this.changeDetectorRef.detectChanges();
    }
  }
}

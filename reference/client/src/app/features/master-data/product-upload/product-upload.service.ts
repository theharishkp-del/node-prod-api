import { Injectable } from '@angular/core';
import { MasterDataApiBaseService } from '../shared/master-data-api-base.service';
import {
  InventoryImportHistoryItem,
  InventorySummary,
  MasterDataInventoryProduct,
  MasterDataListQuery,
  ProductUploadResult,
} from '../shared/master-data.types';

@Injectable({ providedIn: 'root' })
export class ProductUploadService extends MasterDataApiBaseService {
  uploadInventoryFile(file: File, mode: 'merge' | 'replace') {
    const formData = new FormData();
    formData.append('file', file, file.name);
    formData.append('mode', mode);
    return this.uploadForm<ProductUploadResult>('inventory/upload', formData);
  }

  downloadTemplate() {
    return this.getBlob('inventory/template/download');
  }

  listInventoryProducts(query: MasterDataListQuery & { category?: string }) {
    return this.getList<MasterDataInventoryProduct>('inventory', query);
  }

  getInventorySummary() {
    return this.getResource<InventorySummary>('inventory/summary');
  }

  listInventoryCategories() {
    return this.getResource<string[]>('inventory/categories');
  }

  listInventoryImportHistory(limit = 10) {
    return this.getList<InventoryImportHistoryItem>('inventory/import-history', { page: 1, pageSize: limit });
  }

  createInventoryProduct(payload: Partial<MasterDataInventoryProduct>) {
    return this.createItem<MasterDataInventoryProduct>('inventory', payload);
  }

  updateInventoryProduct(id: string, payload: Partial<MasterDataInventoryProduct>) {
    return this.updateItem<MasterDataInventoryProduct>('inventory', id, payload);
  }

  deleteInventoryProduct(id: string) {
    return this.deleteItem('inventory', id);
  }

  uploadProductImage(id: string, file: File) {
    const formData = new FormData();
    formData.append('image', file, file.name);
    return this.uploadForm<{ imageUrl: string }>(`inventory/${id}/image`, formData);
  }
}

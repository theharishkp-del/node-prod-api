import { Injectable } from '@angular/core';
import { MasterDataApiBaseService } from '../shared/master-data-api-base.service';
import { MasterDataListQuery, MasterDataTier } from '../shared/master-data.types';

@Injectable({ providedIn: 'root' })
export class TierService extends MasterDataApiBaseService {
  listTiers(query: MasterDataListQuery = {}) {
    return this.getList<MasterDataTier>('tiers', query);
  }

  getTier(id: string) {
    return this.getItem<MasterDataTier>('tiers', id);
  }

  createTier(payload: Partial<MasterDataTier>) {
    return this.createItem<MasterDataTier>('tiers', payload);
  }

  updateTier(id: string, payload: Partial<MasterDataTier>) {
    return this.updateItem<MasterDataTier>('tiers', id, payload);
  }

  deleteTier(id: string) {
    return this.deleteItem('tiers', id);
  }
}

import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { environment } from '../../environments/environment';

type CartItem = { sku: string; productName: string; description?: string | null; category?: string | null; quantity: number; formattedLineTotal?: string; itemNumber?: number; imageUrl?: string | null };
type UiData = {
  submitStatus: string;
  bookingCompleted: boolean;
  orderLocked: boolean;
  pendingDecision: any;
  cart: { items: CartItem[]; formattedTotal?: string };
  orderReference?: any;
  workOrder?: any;
  quote: any;
  invoice: any;
  paymentLink: any;
};

// Key is `${itemNumber}_${optionIndex}` (1-based, for suggestion items)
type OptionKey = string;
type OptionSelection = { selected: boolean; qty: number };

@Component({
  selector: 'app-cart-selection', standalone: true, imports: [CommonModule, FormsModule],
  templateUrl: './cart-selection.html', styleUrl: './cart-selection.css',
})
export class CartSelection implements OnInit {
  private readonly maxQuantity = 1000;
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly apiBase = `${environment.api.baseUrl}/cart-selection`;

  token = '';
  data: UiData | null = null;
  items: CartItem[] = [];
  removed: CartItem[] = [];

  // Suggestion items: per-option checkbox + qty. key = `${itemNumber}_${optionIndex1Based}`
  optionSelections: Record<OptionKey, OptionSelection> = {};

  // Non-suggestion pending items: qty per itemNumber + skip flag
  pendingItemQty: Record<number, number> = {};
  pendingItemSkipped: Record<number, boolean> = {};

  error = '';
  submitting = false;

  // --- status helpers used in template ---
  readonly ADDABLE_STATUSES = new Set(['fully_available', 'lead_time_only', 'split_availability', 'ready_now', 'full_order_scheduled', 'quantity_missing']);

  isAddable(status: string): boolean { return this.ADDABLE_STATUSES.has(status); }
  isSuggestion(status: string): boolean { return status === 'suggestions'; }
  isUnmatched(status: string): boolean { return status === 'unmatched'; }

  isCartLocked(): boolean {
    return Boolean(this.data?.orderLocked) && !this.data?.bookingCompleted;
  }

  get reviewItems(): any[] {
    const cartSkus = new Set(this.items.map((item) => item.sku));
    return (this.data?.pendingDecision?.items || []).filter((pending: any) => {
      if (pending.status === 'suggestions' || !pending.sku) {
        return true;
      }

      return !cartSkus.has(pending.sku);
    });
  }

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('t') || '';
    if (!this.token) { this.error = 'This cart link is invalid.'; return; }
    this.http.get<{ data: UiData }>(`${this.apiBase}/${encodeURIComponent(this.token)}`).subscribe({
      next: (response) => {
        this.data = response.data;
        this.items = structuredClone(response.data.cart?.items || []);
        this.initPendingState(response.data.pendingDecision?.items || []);
        this.cdr.detectChanges();
      },
      error: (error) => { this.error = error.error?.message || 'Unable to load this cart.'; this.cdr.detectChanges(); },
    });
  }

  private initPendingState(pendingItems: any[]): void {
    this.optionSelections = {};
    this.pendingItemQty = {};
    this.pendingItemSkipped = {};
    for (const pending of pendingItems) {
      if (pending.status === 'suggestions') {
        for (let i = 0; i < (pending.options?.length || 0); i++) {
          this.optionSelections[this.optKey(pending.itemNumber, i + 1)] = { selected: false, qty: 1 };
        }
      } else if (this.isAddable(pending.status)) {
        this.pendingItemQty[pending.itemNumber] = pending.requestedQuantity || 1;
        this.pendingItemSkipped[pending.itemNumber] = false;
      }
    }
  }

  // --- suggestion option helpers ---
  optKey(itemNumber: number, optionIndex: number): OptionKey { return `${itemNumber}_${optionIndex}`; }
  isSelected(itemNumber: number, optionIndex: number): boolean { return this.optionSelections[this.optKey(itemNumber, optionIndex)]?.selected ?? false; }
  toggleOption(itemNumber: number, optionIndex: number): void {
    const key = this.optKey(itemNumber, optionIndex);
    if (this.optionSelections[key]) this.optionSelections[key].selected = !this.optionSelections[key].selected;
  }
  getQty(itemNumber: number, optionIndex: number): number { return this.optionSelections[this.optKey(itemNumber, optionIndex)]?.qty ?? 1; }
  setQty(itemNumber: number, optionIndex: number, value: number): void {
    const key = this.optKey(itemNumber, optionIndex);
    if (this.optionSelections[key]) this.optionSelections[key].qty = Math.min(this.maxQuantity, Math.max(1, Math.floor(+value) || 1));
  }
  decrementQty(itemNumber: number, optionIndex: number): void {
    const key = this.optKey(itemNumber, optionIndex);
    if (this.optionSelections[key]) this.optionSelections[key].qty = Math.max(1, this.optionSelections[key].qty - 1);
  }
  incrementQty(itemNumber: number, optionIndex: number): void {
    const key = this.optKey(itemNumber, optionIndex);
    if (this.optionSelections[key]) this.optionSelections[key].qty = Math.min(this.maxQuantity, this.optionSelections[key].qty + 1);
  }
  clampQty(itemNumber: number, optionIndex: number): void {
    const key = this.optKey(itemNumber, optionIndex);
    if (this.optionSelections[key]) {
      const v = Number(this.optionSelections[key].qty);
      this.optionSelections[key].qty = !Number.isFinite(v) || v < 1 ? 1 : v > this.maxQuantity ? this.maxQuantity : Math.floor(v);
    }
  }

  // --- pending item (non-suggestion) qty + skip helpers ---
  getPendingQty(itemNumber: number): number { return this.pendingItemQty[itemNumber] ?? 1; }
  setPendingQty(itemNumber: number, value: number): void { this.pendingItemQty[itemNumber] = Math.min(this.maxQuantity, Math.max(1, Math.floor(+value) || 1)); }
  decrementPendingQty(itemNumber: number): void { this.pendingItemQty[itemNumber] = Math.max(1, (this.pendingItemQty[itemNumber] ?? 1) - 1); }
  incrementPendingQty(itemNumber: number): void { this.pendingItemQty[itemNumber] = Math.min(this.maxQuantity, (this.pendingItemQty[itemNumber] ?? 1) + 1); }
  clampPendingQty(itemNumber: number): void {
    const v = Number(this.pendingItemQty[itemNumber]);
    this.pendingItemQty[itemNumber] = !Number.isFinite(v) || v < 1 ? 1 : v > this.maxQuantity ? this.maxQuantity : Math.floor(v);
  }
  isSkipped(itemNumber: number): boolean { return this.pendingItemSkipped[itemNumber] ?? false; }
  toggleSkip(itemNumber: number): void { this.pendingItemSkipped[itemNumber] = !this.pendingItemSkipped[itemNumber]; }

  // --- cart item helpers ---
  remove(index: number): void { this.removed.push(this.items[index]); this.items.splice(index, 1); }
  restore(index: number): void { this.items.push(this.removed[index]); this.removed.splice(index, 1); }

  private reload(): void {
    this.http.get<{ data: UiData }>(`${this.apiBase}/${encodeURIComponent(this.token)}`).subscribe({
      next: (response) => {
        this.data = response.data;
        this.items = structuredClone(response.data.cart?.items || []);
        this.initPendingState(response.data.pendingDecision?.items || []);
        this.cdr.detectChanges();
      },
      error: () => { this.cdr.detectChanges(); },
    });
  }

  submit(): void {
    if (!this.data || this.submitting || this.isCartLocked()) return;
    const lines: string[] = [];

    for (const pending of this.data.pendingDecision?.items || []) {
      if (pending.status === 'suggestions') {
        // Multi-option: send every checked option with its qty
        for (let i = 0; i < (pending.options?.length || 0); i++) {
          const sel = this.optionSelections[this.optKey(pending.itemNumber, i + 1)];
          if (sel?.selected) lines.push(`item ${pending.itemNumber} option ${i + 1} qty ${sel.qty}`);
        }
      } else if (this.isAddable(pending.status)) {
        if (this.pendingItemSkipped[pending.itemNumber]) {
          // User ticked "skip" — don't add this item
        } else {
          const qty = this.pendingItemQty[pending.itemNumber] ?? 1;
          lines.push(`item ${pending.itemNumber} qty ${qty}`);
        }
      }
    }

    // Cart edits (for items already in cart)
    const original = this.data.cart?.items || [];
    for (const item of original) {
      const current = this.items.find((c) => c.sku === item.sku);
      if (!current) lines.push(`remove ${item.sku}`);
      else if (Number(current.quantity) !== Number(item.quantity)) lines.push(`update ${item.sku} qty ${current.quantity}`);
    }

    if (!lines.length) { this.error = 'Set quantities or make a cart change before submitting.'; return; }
    this.error = '';
    this.submitting = true;
    this.http.post(`${this.apiBase}/${encodeURIComponent(this.token)}/submit`, { message: lines.join('\n') }).subscribe({
      next: () => { this.removed = []; this.submitting = false; this.reload(); },
      error: (error) => { this.error = error.error?.message || 'Unable to submit your selection.'; this.submitting = false; this.cdr.detectChanges(); },
    });
  }
}

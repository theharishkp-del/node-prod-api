import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MasterDataCustomer, MasterDataFormMode, MasterDataQuote } from '../shared/master-data.types';
import { buildNextDocumentNumber, extractNumberPrefix, formatDateInputValue } from '../shared/document-number.util';

type QuoteLineItemFormGroup = FormGroup<{
  itemId: FormControl<string | null>;
  name: FormControl<string | null>;
  description: FormControl<string | null>;
  quantity: FormControl<number | null>;
  rate: FormControl<number | null>;
  discount: FormControl<number | null>;
  taxPercentage: FormControl<number | null>;
}>;

@Component({
  selector: 'app-quote-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './quote-form.component.html',
  styleUrl: './quote-form.component.css',
})
export class QuoteFormComponent implements OnChanges {
  @Input() mode: MasterDataFormMode = 'create';
  @Input() quote: MasterDataQuote | null = null;
  @Input() customers: MasterDataCustomer[] = [];
  @Input() existingQuoteNumbers: string[] = [];
  @Input() saving = false;
  @Input() errorMessage = '';
  @Output() save = new EventEmitter<Partial<MasterDataQuote>>();
  @Output() cancel = new EventEmitter<void>();

  private readonly fb = new FormBuilder();
  private lastHydratedState = '';

  readonly form = this.fb.group({
    quoteNumberPrefix: ['QT', Validators.required],
    quoteNumber: ['', Validators.required],
    customerId: ['', Validators.required],
    quoteDate: ['', Validators.required],
    expiryDate: [''],
    status: ['draft', Validators.required],
    notes: [''],
    termsAndConditions: [''],
    lineItems: this.fb.array<QuoteLineItemFormGroup>([]),
  });

  get lineItems(): FormArray<QuoteLineItemFormGroup> {
    return this.form.get('lineItems') as FormArray<QuoteLineItemFormGroup>;
  }

  get isViewMode(): boolean {
    return this.mode === 'view';
  }

  get isCreateMode(): boolean {
    return this.mode === 'create';
  }

  ngOnChanges(changes: SimpleChanges): void {
    const currentHydratedState = `${this.mode}:${this.quote?.id ?? 'new'}`;

    if (!changes['mode'] && !changes['quote'] && this.lastHydratedState === currentHydratedState) {
      return;
    }

    this.lastHydratedState = currentHydratedState;

    const value = this.quote;
    const quoteNumberPrefix = extractNumberPrefix(value?.quoteNumber ?? '', 'QT');

    this.form.reset({
      quoteNumberPrefix,
      quoteNumber: value?.quoteNumber ?? '',
      customerId: value?.customerId ?? '',
      quoteDate: value?.quoteDate ? String(value.quoteDate).slice(0, 10) : formatDateInputValue(),
      expiryDate: value?.expiryDate ? String(value.expiryDate).slice(0, 10) : '',
      status: value?.status ?? 'draft',
      notes: value?.notes ?? '',
      termsAndConditions: value?.termsAndConditions ?? '',
    });

    this.lineItems.clear();
    const lineItems = value?.lineItems?.length ? value.lineItems : [null];
    lineItems.forEach((lineItem) => this.lineItems.push(this.createLineItemGroup(lineItem ?? undefined)));

    if (this.isViewMode) {
      this.form.disable({ emitEvent: false });
    } else {
      this.form.enable({ emitEvent: false });
    }

    if (this.isViewMode) {
      this.form.get('quoteNumberPrefix')?.disable({ emitEvent: false });
      this.form.get('quoteNumber')?.disable({ emitEvent: false });
    } else if (this.isCreateMode) {
      this.form.get('quoteNumber')?.disable({ emitEvent: false });
      this.updateGeneratedQuoteNumber();
    } else {
      this.form.get('quoteNumberPrefix')?.disable({ emitEvent: false });
      this.form.get('quoteNumber')?.enable({ emitEvent: false });
    }
  }

  private createLineItemGroup(value?: MasterDataQuote['lineItems'][number]): QuoteLineItemFormGroup {
    return this.fb.group({
      itemId: [value?.itemId ?? ''],
      name: [value?.name ?? '', Validators.required],
      description: [value?.description ?? ''],
      quantity: [value?.quantity ?? 1, Validators.required],
      rate: [value?.rate ?? 0, Validators.required],
      discount: [value?.discount ?? 0],
      taxPercentage: [value?.taxPercentage ?? 0],
    });
  }

  addLineItem(): void {
    this.lineItems.push(this.createLineItemGroup());
  }

  removeLineItem(index: number): void {
    if (this.lineItems.length === 1) {
      return;
    }

    this.lineItems.removeAt(index);
  }

  getPreviewTotal(index: number): number {
    const group = this.lineItems.at(index);
    const quantity = Number(group.get('quantity')?.value || 0);
    const rate = Number(group.get('rate')?.value || 0);
    const discount = Number(group.get('discount')?.value || 0);
    const taxPercentage = Number(group.get('taxPercentage')?.value || 0);
    const base = Math.max(quantity * rate - discount, 0);
    return Number((base + ((base * taxPercentage) / 100)).toFixed(2));
  }

  get overallTotal(): number {
    return this.lineItems.controls.reduce((sum, _control, index) => sum + this.getPreviewTotal(index), 0);
  }

  onQuotePrefixChange(): void {
    if (!this.isCreateMode || this.isViewMode) {
      return;
    }

    this.updateGeneratedQuoteNumber();
  }

  private updateGeneratedQuoteNumber(): void {
    const prefix = String(this.form.get('quoteNumberPrefix')?.value || 'QT').trim().toUpperCase() || 'QT';
    const quoteNumber = buildNextDocumentNumber(this.existingQuoteNumbers, prefix);

    this.form.patchValue({
      quoteNumberPrefix: prefix,
      quoteNumber,
    }, { emitEvent: false });
  }

  onSubmit(): void {
    if (this.isViewMode) {
      this.cancel.emit();
      return;
    }

    if (this.form.invalid || !this.lineItems.length) {
      this.form.markAllAsTouched();
      return;
    }

    const { quoteNumberPrefix: _quoteNumberPrefix, ...payload } = this.form.getRawValue();
    this.save.emit(payload as Partial<MasterDataQuote>);
  }
}

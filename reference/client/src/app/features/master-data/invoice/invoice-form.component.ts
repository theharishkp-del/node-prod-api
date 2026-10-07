import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MasterDataCustomer, MasterDataFormMode, MasterDataInvoice, MasterDataQuote } from '../shared/master-data.types';
import { buildNextDocumentNumber, extractNumberPrefix, formatDateInputValue } from '../shared/document-number.util';

type InvoiceLineItemFormGroup = FormGroup<{
  itemId: FormControl<string | null>;
  name: FormControl<string | null>;
  description: FormControl<string | null>;
  quantity: FormControl<number | null>;
  rate: FormControl<number | null>;
  discount: FormControl<number | null>;
  taxPercentage: FormControl<number | null>;
}>;

@Component({
  selector: 'app-invoice-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './invoice-form.component.html',
  styleUrl: './invoice-form.component.css',
})
export class InvoiceFormComponent implements OnChanges {
  @Input() mode: MasterDataFormMode = 'create';
  @Input() invoice: MasterDataInvoice | null = null;
  @Input() customers: MasterDataCustomer[] = [];
  @Input() quotes: MasterDataQuote[] = [];
  @Input() existingInvoiceNumbers: string[] = [];
  @Input() saving = false;
  @Input() errorMessage = '';
  @Output() save = new EventEmitter<Partial<MasterDataInvoice>>();
  @Output() cancel = new EventEmitter<void>();

  private readonly fb = new FormBuilder();
  private lastHydratedState = '';

  readonly form = this.fb.group({
    invoiceNumberPrefix: ['INV', Validators.required],
    invoiceNumber: ['', Validators.required],
    customerId: ['', Validators.required],
    quoteId: [''],
    invoiceDate: ['', Validators.required],
    dueDate: ['', Validators.required],
    status: ['draft', Validators.required],
    notes: [''],
    termsAndConditions: [''],
    lineItems: this.fb.array<InvoiceLineItemFormGroup>([]),
  });

  get lineItems(): FormArray<InvoiceLineItemFormGroup> {
    return this.form.get('lineItems') as FormArray<InvoiceLineItemFormGroup>;
  }

  get isViewMode(): boolean {
    return this.mode === 'view';
  }

  get isCreateMode(): boolean {
    return this.mode === 'create';
  }

  get filteredQuotes(): MasterDataQuote[] {
    const customerId = this.form.get('customerId')?.value;
    return this.quotes.filter((quote) => !customerId || quote.customerId === customerId);
  }

  ngOnChanges(changes: SimpleChanges): void {
    const currentHydratedState = `${this.mode}:${this.invoice?.id ?? 'new'}`;

    if (!changes['mode'] && !changes['invoice'] && this.lastHydratedState === currentHydratedState) {
      return;
    }

    this.lastHydratedState = currentHydratedState;

    const value = this.invoice;
    const invoiceDate = value?.invoiceDate ? String(value.invoiceDate).slice(0, 10) : formatDateInputValue();
    const dueDate = value?.dueDate ? String(value.dueDate).slice(0, 10) : invoiceDate;
    const invoiceNumberPrefix = extractNumberPrefix(value?.invoiceNumber ?? '', 'INV');

    this.form.reset({
      invoiceNumberPrefix,
      invoiceNumber: value?.invoiceNumber ?? '',
      customerId: value?.customerId ?? '',
      quoteId: value?.quoteId ?? '',
      invoiceDate,
      dueDate,
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
      this.form.get('invoiceNumberPrefix')?.disable({ emitEvent: false });
      this.form.get('invoiceNumber')?.disable({ emitEvent: false });
    } else if (this.isCreateMode) {
      this.form.get('invoiceNumber')?.disable({ emitEvent: false });
      this.updateGeneratedInvoiceNumber();
    } else {
      this.form.get('invoiceNumberPrefix')?.disable({ emitEvent: false });
      this.form.get('invoiceNumber')?.enable({ emitEvent: false });
    }
  }

  private createLineItemGroup(value?: MasterDataInvoice['lineItems'][number]): InvoiceLineItemFormGroup {
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

  onInvoicePrefixChange(): void {
    if (!this.isCreateMode || this.isViewMode) {
      return;
    }

    this.updateGeneratedInvoiceNumber();
  }

  onCustomerChange(): void {
    const customerId = String(this.form.get('customerId')?.value || '').trim();
    const quoteId = String(this.form.get('quoteId')?.value || '').trim();

    if (!customerId || !quoteId) {
      return;
    }

    const selectedQuote = this.quotes.find((quote) => quote.id === quoteId);

    if (selectedQuote && selectedQuote.customerId !== customerId) {
      this.form.patchValue({ quoteId: '' }, { emitEvent: false });
    }
  }

  onQuoteChange(): void {
    const quoteId = String(this.form.get('quoteId')?.value || '').trim();

    if (!quoteId) {
      return;
    }

    const selectedQuote = this.quotes.find((quote) => quote.id === quoteId);

    if (!selectedQuote) {
      return;
    }

    this.form.patchValue({
      customerId: selectedQuote.customerId,
      notes: selectedQuote.notes ?? '',
      termsAndConditions: selectedQuote.termsAndConditions ?? '',
    }, { emitEvent: false });

    this.lineItems.clear();
    const lineItems = selectedQuote.lineItems?.length ? selectedQuote.lineItems : [null];
    lineItems.forEach((lineItem) => this.lineItems.push(this.createLineItemGroup(lineItem ?? undefined)));
  }

  private updateGeneratedInvoiceNumber(): void {
    const prefix = String(this.form.get('invoiceNumberPrefix')?.value || 'INV').trim().toUpperCase() || 'INV';
    const invoiceNumber = buildNextDocumentNumber(this.existingInvoiceNumbers, prefix);

    this.form.patchValue({
      invoiceNumberPrefix: prefix,
      invoiceNumber,
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

    const { invoiceNumberPrefix: _invoiceNumberPrefix, ...payload } = this.form.getRawValue();
    this.save.emit(payload as Partial<MasterDataInvoice>);
  }
}

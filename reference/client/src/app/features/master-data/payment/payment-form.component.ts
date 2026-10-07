import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MasterDataCustomer, MasterDataFormMode, MasterDataInvoice, MasterDataPayment } from '../shared/master-data.types';
import { buildNextDocumentNumber, extractNumberPrefix, formatDateInputValue } from '../shared/document-number.util';

@Component({
  selector: 'app-payment-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './payment-form.component.html',
  styleUrl: './payment-form.component.css',
})
export class PaymentFormComponent implements OnChanges {
  @Input() mode: MasterDataFormMode = 'create';
  @Input() payment: MasterDataPayment | null = null;
  @Input() customers: MasterDataCustomer[] = [];
  @Input() invoices: MasterDataInvoice[] = [];
  @Input() existingPaymentNumbers: string[] = [];
  @Input() saving = false;
  @Input() errorMessage = '';
  @Output() save = new EventEmitter<Partial<MasterDataPayment>>();
  @Output() cancel = new EventEmitter<void>();

  private readonly fb = new FormBuilder();
  private lastHydratedState = '';

  readonly form = this.fb.group({
    paymentNumberPrefix: ['PAY', Validators.required],
    paymentNumber: ['', Validators.required],
    customerId: ['', Validators.required],
    invoiceId: ['', Validators.required],
    paymentDate: ['', Validators.required],
    amount: [0, Validators.required],
    paymentMode: ['cash', Validators.required],
    status: ['success', Validators.required],
    referenceNumber: [''],
    gatewayProvider: [''],
    gatewayPaymentId: [''],
    notes: [''],
  });

  get isViewMode(): boolean {
    return this.mode === 'view';
  }

  get isCreateMode(): boolean {
    return this.mode === 'create';
  }

  get filteredInvoices(): MasterDataInvoice[] {
    const customerId = this.form.get('customerId')?.value;
    const selectedInvoiceId = String(this.form.get('invoiceId')?.value || '').trim();

    return this.invoices.filter((invoice) => {
      if (!customerId) {
        return true;
      }

      if (selectedInvoiceId && invoice.id === selectedInvoiceId) {
        return true;
      }

      return invoice.customerId === customerId;
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    const currentHydratedState = `${this.mode}:${this.payment?.id ?? 'new'}`;

    if (!changes['mode'] && !changes['payment'] && this.lastHydratedState === currentHydratedState) {
      return;
    }

    this.lastHydratedState = currentHydratedState;

    const value = this.payment;
    const paymentNumberPrefix = extractNumberPrefix(value?.paymentNumber ?? '', 'PAY');

    this.form.reset({
      paymentNumberPrefix,
      paymentNumber: value?.paymentNumber ?? '',
      customerId: value?.customerId ?? '',
      invoiceId: value?.invoiceId ?? '',
      paymentDate: value?.paymentDate ? String(value.paymentDate).slice(0, 10) : formatDateInputValue(),
      amount: value?.amount ?? 0,
      paymentMode: value?.paymentMode ?? 'cash',
      status: value?.status ?? 'success',
      referenceNumber: value?.referenceNumber ?? '',
      gatewayProvider: value?.gatewayProvider ?? '',
      gatewayPaymentId: value?.gatewayPaymentId ?? '',
      notes: value?.notes ?? '',
    });

    if (this.isViewMode) {
      this.form.disable({ emitEvent: false });
    } else {
      this.form.enable({ emitEvent: false });
    }

    if (this.isViewMode) {
      this.form.get('paymentNumberPrefix')?.disable({ emitEvent: false });
      this.form.get('paymentNumber')?.disable({ emitEvent: false });
    } else if (this.isCreateMode) {
      this.form.get('paymentNumber')?.disable({ emitEvent: false });
      this.updateGeneratedPaymentNumber();
    } else {
      this.form.get('paymentNumberPrefix')?.disable({ emitEvent: false });
      this.form.get('paymentNumber')?.enable({ emitEvent: false });
    }
  }

  onPaymentPrefixChange(): void {
    if (!this.isCreateMode || this.isViewMode) {
      return;
    }

    this.updateGeneratedPaymentNumber();
  }

  onCustomerChange(): void {
    const customerId = String(this.form.get('customerId')?.value || '').trim();
    const invoiceId = String(this.form.get('invoiceId')?.value || '').trim();

    if (!customerId || !invoiceId) {
      return;
    }

    const selectedInvoice = this.invoices.find((invoice) => invoice.id === invoiceId);

    if (selectedInvoice && selectedInvoice.customerId !== customerId) {
      this.form.patchValue({ invoiceId: '', amount: 0 }, { emitEvent: false });
    }
  }

  onInvoiceChange(): void {
    const invoiceId = String(this.form.get('invoiceId')?.value || '').trim();

    if (!invoiceId) {
      return;
    }

    const selectedInvoice = this.invoices.find((invoice) => invoice.id === invoiceId);

    if (!selectedInvoice) {
      return;
    }

    this.form.patchValue({
      customerId: selectedInvoice.customerId,
      amount: Number(selectedInvoice.balanceAmount || 0),
    }, { emitEvent: false });
  }

  private updateGeneratedPaymentNumber(): void {
    const prefix = String(this.form.get('paymentNumberPrefix')?.value || 'PAY').trim().toUpperCase() || 'PAY';
    const paymentNumber = buildNextDocumentNumber(this.existingPaymentNumbers, prefix);

    this.form.patchValue({
      paymentNumberPrefix: prefix,
      paymentNumber,
    }, { emitEvent: false });
  }

  onSubmit(): void {
    if (this.isViewMode) {
      this.cancel.emit();
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { paymentNumberPrefix: _paymentNumberPrefix, ...payload } = this.form.getRawValue();
    this.save.emit(payload as Partial<MasterDataPayment>);
  }
}

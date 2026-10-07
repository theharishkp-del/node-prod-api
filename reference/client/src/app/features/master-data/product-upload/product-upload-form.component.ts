import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MasterDataFormMode, MasterDataInventoryProduct } from '../shared/master-data.types';

@Component({
  selector: 'app-product-upload-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './product-upload-form.component.html',
  styleUrl: './product-upload-form.component.css',
})
export class ProductUploadFormComponent implements OnChanges {
  @Input() mode: MasterDataFormMode = 'create';
  @Input() product: MasterDataInventoryProduct | null = null;
  @Input() saving = false;
  @Input() errorMessage = '';
  @Output() saveRequested = new EventEmitter<Partial<MasterDataInventoryProduct>>();
  @Output() cancelRequested = new EventEmitter<void>();

  private readonly fb = new FormBuilder();

  readonly form = this.fb.group({
    sku: ['', Validators.required],
    itemName: ['', Validators.required],
    category: ['', Validators.required],
    description: [''],
    finish: [''],
    salesPrice: [null as number | null],
    qtyAvailable: [null as number | null],
    unit: ['each'],
    generalSku: [''],
    style: [''],
    width: [null as number | null],
    height: [null as number | null],
    depth: [null as number | null],
    purchasePrice: [null as number | null],
    leadTimeDays: [null as number | null],
    notes: [''],
    isActive: [true],
  });

  get isViewMode(): boolean {
    return this.mode === 'view';
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['product'] || changes['mode']) {
      this.form.reset({
        sku: this.product?.sku ?? '',
        itemName: this.product?.itemName ?? '',
        category: this.product?.category ?? '',
        description: this.product?.description ?? '',
        finish: this.product?.finish ?? '',
        salesPrice: this.product?.salesPrice ?? null,
        qtyAvailable: this.product?.qtyAvailable ?? null,
        unit: this.product?.unit ?? 'each',
        generalSku: this.product?.generalSku ?? '',
        style: this.product?.style ?? '',
        width: this.product?.width ?? null,
        height: this.product?.height ?? null,
        depth: this.product?.depth ?? null,
        purchasePrice: this.product?.purchasePrice ?? null,
        leadTimeDays: this.product?.leadTimeDays ?? null,
        notes: this.product?.notes ?? '',
        isActive: this.product?.isActive ?? true,
      });
    }

    if (this.isViewMode) {
      this.form.disable({ emitEvent: false });
    } else {
      this.form.enable({ emitEvent: false });
    }
  }

  onSubmit(): void {
    if (this.isViewMode) {
      this.cancelRequested.emit();
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const formValue = this.form.getRawValue();
    this.saveRequested.emit({
      sku: formValue.sku ?? '',
      itemName: formValue.itemName ?? '',
      category: formValue.category ?? '',
      description: formValue.description ?? '',
      finish: formValue.finish ?? '',
      salesPrice: formValue.salesPrice,
      qtyAvailable: formValue.qtyAvailable,
      unit: formValue.unit ?? 'each',
      generalSku: formValue.generalSku ?? '',
      style: formValue.style ?? '',
      width: formValue.width,
      height: formValue.height,
      depth: formValue.depth,
      purchasePrice: formValue.purchasePrice,
      leadTimeDays: formValue.leadTimeDays,
      notes: formValue.notes ?? '',
      isActive: Boolean(formValue.isActive),
    });
  }
}

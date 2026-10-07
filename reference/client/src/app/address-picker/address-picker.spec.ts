import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AddressPicker } from './address-picker';

describe('AddressPicker', () => {
  let component: AddressPicker;
  let fixture: ComponentFixture<AddressPicker>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AddressPicker],
    }).compileComponents();

    fixture = TestBed.createComponent(AddressPicker);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CompanyDetails } from './company-details';

describe('CompanyDetails', () => {
  let component: CompanyDetails;
  let fixture: ComponentFixture<CompanyDetails>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CompanyDetails],
    }).compileComponents();

    fixture = TestBed.createComponent(CompanyDetails);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

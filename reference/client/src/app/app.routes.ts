import { Routes } from '@angular/router';
import { CompanyDetails } from './company-details/company-details';
import { BranchForm } from './branch-form/branch-form';
import { CybotUserRegistration } from './cybot-user-registration/cybot-user-registration';
import { branchStepGuard, cybotUserStepGuard } from './guards/onboarding-step.guard';
import { OnboardingSuccess } from './onboarding-success/onboarding-success';
import { MissingKey } from './missing-key/missing-key';
import { ZohoCallback } from './zoho-callback/zoho-callback';
import { BusinessDashboardComponent } from './features/master-data/business-dashboard.component';
import { MasterDataComponent } from './features/master-data/master-data.component';
import { ReportsComponent } from './features/master-data/reports.component';
import { ProductUploadComponent } from './features/master-data/product-upload/product-upload.component';
import { CustomerHistoryComponent } from './features/master-data/customer-history/customer-history.component';
import { AdminCalendarComponent } from './features/master-data/admin-calendar/admin-calendar.component';
import { DeveloperMonitorComponent } from './features/developer-monitor/developer-monitor.component';
import { CartSelection } from './cart-selection/cart-selection';
import { TemplateCalendarTestComponent } from './features/template-calendar-test/template-calendar-test.component';


export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'bot-register' },
  { path: 'missing-key', component: MissingKey },
  { path: 'bot-register', component: CompanyDetails },
  { path: 'branch-details', component: BranchForm, canActivate: [branchStepGuard] },
  {
    path: 'cybot-user-registration',
    component: CybotUserRegistration,
    canActivate: [cybotUserStepGuard],
  },
  { path: 'zoho/callback', component: ZohoCallback },
  { path: 'dashboard', component: BusinessDashboardComponent },
  { path: 'reports', component: ReportsComponent },
  { path: 'master-data', component: MasterDataComponent },
  { path: 'customer-history', component: CustomerHistoryComponent },
  { path: 'admin-calendar', component: AdminCalendarComponent },
  { path: 'template-calendar-test', component: TemplateCalendarTestComponent },
  { path: 'product-upload', component: ProductUploadComponent },
  { path: 'developer-monitor', component: DeveloperMonitorComponent },
  { path: 'onboarding-success', component: OnboardingSuccess },
  { path: 'cart-selection', component: CartSelection },
  { path: '**', redirectTo: 'missing-key' },
];

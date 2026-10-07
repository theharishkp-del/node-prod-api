/**
 * @file Route table of the admin UI; everything except /login is behind authGuard and rendered inside the Shell layout.
 */
import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

/** Routes; feature pages are lazy loaded. All pages except /login need a valid admin key. */
export const routes: Routes = [
  { path: 'login', title: 'Sign in · IQ Agent Admin', loadComponent: () => import('./features/login/login').then((m) => m.Login) },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        title: 'Dashboard · IQ Agent Admin',
        loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
      },
      {
        path: 'organizations',
        title: 'Organizations · IQ Agent Admin',
        loadComponent: () => import('./features/organizations/organization-list').then((m) => m.OrganizationList),
      },
      {
        path: 'organizations/new',
        title: 'New organization · IQ Agent Admin',
        loadComponent: () => import('./features/organizations/organization-form').then((m) => m.OrganizationForm),
      },
      {
        path: 'organizations/:orgId',
        title: 'Organization · IQ Agent Admin',
        loadComponent: () => import('./features/organizations/organization-detail').then((m) => m.OrganizationDetail),
      },
      {
        path: 'organizations/:orgId/edit',
        title: 'Edit organization · IQ Agent Admin',
        loadComponent: () => import('./features/organizations/organization-form').then((m) => m.OrganizationForm),
      },
      {
        path: 'organizations/:orgId/sessions/:sessionId',
        title: 'Session · IQ Agent Admin',
        loadComponent: () => import('./features/sessions/session-detail').then((m) => m.SessionDetail),
      },
      {
        path: 'bots',
        title: 'Bots · IQ Agent Admin',
        loadComponent: () => import('./features/bots/bot-list').then((m) => m.BotList),
      },
      {
        path: 'bots/new',
        title: 'New bot · IQ Agent Admin',
        loadComponent: () => import('./features/bots/bot-form').then((m) => m.BotForm),
      },
      {
        path: 'bots/:botUserId/edit',
        title: 'Edit bot · IQ Agent Admin',
        loadComponent: () => import('./features/bots/bot-form').then((m) => m.BotForm),
      },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];

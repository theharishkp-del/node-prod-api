import { bootstrapApplication } from '@angular/platform-browser';
import { VERSION as angularVersion } from '@angular/core';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { environment } from './environments/environment';

const browserBundle = typeof document !== 'undefined'
  ? Array.from(document.scripts)
      .map((script) => script.src)
      .find((src) => /\/main-[^/]+\.js(?:\?|$)/.test(src)) || 'unknown'
  : 'server';

console.info('[OFA Angular build]', {
  appVersion: environment.appVersion,
  environment: environment.name,
  production: environment.production,
  angularVersion: angularVersion.full,
  browserBundle,
});

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));

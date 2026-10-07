/**
 * @file Build-time settings of the admin UI (app name, relative API base).
 */
/**
 * Runtime settings of the admin UI.
 *
 * apiBaseUrl is resolved against the document <base href> (/iqagent/admin/), so the
 * default '../api/admin/' targets /iqagent/api/admin/ on the same origin - in production
 * (Express serves the build) and with `ng serve` (proxy.conf.json forwards /iqagent/api).
 * An absolute URL (https://host/iqagent/api/admin/) also works.
 */
export const environment = {
  appName: 'IQ Agent Admin',
  apiBaseUrl: '../api/admin/',
};

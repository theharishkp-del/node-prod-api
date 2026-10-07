/**
 * @file Resolves the admin API base URL relative to the document base href (works under /iqagent/admin/).
 */
import { environment } from '../../environments/environment';

/**
 * Absolute admin API base URL (always ends with '/'), resolved from environment.apiBaseUrl
 * against the document base URI (<base href="/iqagent/admin/">).
 */
export function resolveApiBase(baseUri: string = document.baseURI): string {
  const raw = environment.apiBaseUrl.endsWith('/') ? environment.apiBaseUrl : `${environment.apiBaseUrl}/`;
  return new URL(raw, baseUri).href;
}

export const API_BASE = resolveApiBase();

'use strict';

/**
 * Serves Angular production builds (folder containing index.html) under
 * `${APP_BASE_PATH}/${name}/` with:
 *  - redirect `${base}/${name}` -> `${base}/${name}/` (relative asset URLs / <base href> need it)
 *  - long immutable caching for hashed assets, no-cache for index.html
 *  - SPA fallback: extension-less GET/HEAD paths return index.html (deep links)
 *  - real 404 for missing files with an extension (e.g. /main.missing.js) and for /api/*
 * Missing dist folder / index.html => warning logged, app skipped (no crash).
 */
const fs = require('fs');
const path = require('path');
const express = require('express');

const HASHED_ASSET = /[.-][0-9a-zA-Z]{8,}\.[a-z0-9]+$|[.-][a-f0-9]{6,}\.[a-z0-9]+$/;
const ONE_YEAR = 'public, max-age=31536000, immutable';
const NO_CACHE = 'no-cache';

function markStatic(req, res, next) {
  res.locals.isStaticAsset = true;
  next();
}

function setCacheHeaders(res, filePath) {
  const base = path.basename(filePath);
  if (base === 'index.html' || !HASHED_ASSET.test(base)) res.setHeader('Cache-Control', NO_CACHE);
  else res.setHeader('Cache-Control', ONE_YEAR);
}

function createAngularRouter(distPath) {
  const indexFile = path.join(distPath, 'index.html');
  const router = express.Router({ strict: true });

  router.use(markStatic);

  // `${base}/${name}` (no trailing slash) -> redirect, keep query string.
  router.use((req, res, next) => {
    if (req.path === '/' && !req.originalUrl.split('?')[0].endsWith('/')) {
      const [p, q] = req.originalUrl.split('?');
      return res.redirect(301, `${p}/${q !== undefined ? `?${q}` : ''}`);
    }
    return next();
  });

  router.use(
    express.static(distPath, {
      index: 'index.html',
      redirect: false,
      fallthrough: true,
      setHeaders: setCacheHeaders,
    }),
  );

  // SPA fallback (Express 5 path syntax).
  router.get('/{*splat}', (req, res, next) => {
    const p = req.path;
    if (p === '/api' || p.startsWith('/api/')) return next(); // never swallow API calls
    if (path.extname(p)) return next(); // missing asset -> 404 via notFound handler
    res.setHeader('Cache-Control', NO_CACHE);
    return res.sendFile(indexFile, (err) => err && next(err));
  });

  return router;
}

function buildAngularApps(apps, basePath, logger) {
  const mounted = [];
  for (const { name, distPath } of apps) {
    const indexFile = path.join(distPath, 'index.html');
    if (!fs.existsSync(indexFile)) {
      logger.warn(
        `Angular app "${name}" NOT mounted: ${indexFile} not found. ` +
          'Build with `ng build --base-href <APP_BASE_PATH>/<name>/` and copy the output to ANGULAR_DIST_PATH.',
        { event: 'angular.skip', app: name, distPath },
      );
      continue;
    }
    const mountPath = `${basePath}/${name}`;
    logger.info(`Angular app "${name}" served at ${mountPath}/ from ${distPath}`, {
      event: 'angular.mount',
      app: name,
      distPath,
    });
    mounted.push({ name, mountPath, router: createAngularRouter(distPath) });
  }
  return mounted;
}

module.exports = { buildAngularApps, createAngularRouter };

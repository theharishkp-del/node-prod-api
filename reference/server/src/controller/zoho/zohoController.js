import {
  buildZohoAuthorizeUrl,
  buildZohoFailureRedirect,
  getZohoIntegrationStatus,
  handleZohoOAuthCallback,
  selectZohoOrganizationForBot,
  updateZohoAutoSyncForBot,
} from '../../services/zohoOAuthService.js';
import { scheduleZohoInitialImportForBot } from '../../services/zohoInitialImportService.js';
import { logControllerStep } from '../web/shared/controllerUtils.js';

export function getZohoAuthorizeLink(req, res, next) {
  try {
    const authorizeUrl = buildZohoAuthorizeUrl(req.body?.botMasterKey || {});
    logControllerStep(req, 'Zoho authorize link prepared', {
      hasAuthorizeUrl: Boolean(authorizeUrl),
    });

    return res.status(200).json({
      status: 'ok',
      authorizeUrl,
    });
  } catch (error) {
    next(error);
  }
}

export async function getExistingZohoStatus(req, res, next) {
  try {
    logControllerStep(req, 'Zoho status lookup started', {
      botMasterKeyPresent: Boolean(req.body?.botMasterKey),
    });

    const result = await getZohoIntegrationStatus(req.body?.botMasterKey || {});
    logControllerStep(req, 'Zoho status lookup completed', {
      statusCode: 200,
      connected: result.connected ?? null,
      organizationId: result.organizationId ?? null,
      autoSyncEnabled: result.autoSyncEnabled ?? null,
    });

    return res.status(200).json({
      status: 'ok',
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

export async function selectZohoOrganization(req, res, next) {
  try {
    logControllerStep(req, 'Zoho organization selection started', {
      organizationId: req.body?.organizationId ?? null,
    });

    const result = await selectZohoOrganizationForBot({
      botMasterKey: req.body?.botMasterKey || {},
      organizationId: req.body?.organizationId || '',
    });
    const initialImport = await scheduleZohoInitialImportForBot({
      botMasterKey: req.body?.botMasterKey || {},
    });
    logControllerStep(req, 'Zoho organization selection completed', {
      statusCode: 200,
      organizationId: result.organizationId,
      organizationName: result.organizationName,
      initialImportStatus: initialImport?.status ?? null,
    });

    return res.status(200).json({
      status: 'ok',
      message: 'Zoho Books organization selected successfully.',
      organizationId: result.organizationId,
      organizationName: result.organizationName,
      initialImport,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateZohoAutoSync(req, res, next) {
  try {
    logControllerStep(req, 'Zoho auto sync update started', {
      autoSyncEnabled: req.body?.autoSyncEnabled ?? null,
    });

    const result = await updateZohoAutoSyncForBot({
      botMasterKey: req.body?.botMasterKey || {},
      autoSyncEnabled: req.body?.autoSyncEnabled,
    });
    logControllerStep(req, 'Zoho auto sync update completed', {
      statusCode: 200,
      autoSyncEnabled: result.autoSyncEnabled,
      organizationId: result.organizationId ?? null,
    });

    return res.status(200).json({
      status: 'ok',
      message: `Zoho auto sync ${result.autoSyncEnabled ? 'enabled' : 'disabled'} successfully.`,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

export async function handleZohoCallback(req, res, next) {
  try {
    logControllerStep(req, 'Zoho OAuth callback started', {
      codePresent: Boolean(req.query.code),
      statePresent: Boolean(req.query.state),
      error: req.query.error || null,
      accountsServer: req.query['accounts-server'] || null,
      location: req.originalUrl,
    });

    const result = await handleZohoOAuthCallback({
      code: req.query.code,
      state: req.query.state,
      error: req.query.error,
      accountsServer: req.query['accounts-server'],
    });

    if (result.redirectUrl) {
      logControllerStep(req, 'Zoho OAuth callback redirect prepared', {
        redirectUrlPresent: true,
        organizationId: result.organizationId ?? null,
      });
      return res.redirect(result.redirectUrl);
    }

    logControllerStep(req, 'Zoho OAuth callback completed', {
      statusCode: 200,
      organizationId: result.organizationId ?? null,
      organizationName: result.organizationName ?? null,
    });

    return res.status(200).json({
      status: 'success',
      message: 'Zoho Books connected successfully.',
      organizationId: result.organizationId,
      organizationName: result.organizationName,
    });
  } catch (error) {
    logControllerStep(req, 'Zoho OAuth callback failed', {
      errorMessage: error.message,
      accountsServer: req.query['accounts-server'] || null,
      error: req.query.error || null,
      codePresent: Boolean(req.query.code),
      statePresent: Boolean(req.query.state),
      location: req.originalUrl,
    });

    const redirectUrl = buildZohoFailureRedirect({
      state: req.query.state,
      message: error.message || 'Zoho Books connection failed.',
    });

    if (redirectUrl) {
      return res.redirect(redirectUrl);
    }

    next(error);
  }
}

import { fetchExistingOnboarding, provisionTenantAndCreateCustomer } from '../../services/onboardingService.js';
import { fetchCybotUserDetails } from '../../services/cybotUserLookupService.js';
import { logControllerStep } from './shared/controllerUtils.js';

export async function getUserDetails(req, res, next) {
  try {
    logControllerStep(req, 'Cybot lookup started', {
      lookupType: req.body?.lookupType ?? null,
      mobileNumber: req.body?.mobileNumber ?? null,
      email: req.body?.email ?? null,
    });

    const result = await fetchCybotUserDetails(req.body);

    if (!result.found) {
      const responseBody = {
        status: 'not_found',
        message: result.message,
        requestPayload: result.requestPayload,
      };

      logControllerStep(req, 'Cybot lookup completed', {
        statusCode: 200,
        found: false,
        responseStatus: responseBody.status,
        responseMessage: responseBody.message,
      });

      return res.status(200).json(responseBody);
    }

    const responseBody = {
      status: 'ok',
      message: result.message,
      requestPayload: result.requestPayload,
      userDetails: result.userDetails,
    };

    logControllerStep(req, 'Cybot lookup completed', {
      statusCode: 200,
      found: true,
      responseStatus: responseBody.status,
      responseMessage: responseBody.message,
      userId: result.userDetails?.userId ?? null,
    });

    return res.status(200).json(responseBody);
  } catch (error) {
    next(error);
  }
}

export async function createOnboardingRequest(req, res, next) {
  try {
    logControllerStep(req, 'Onboarding create started', {
      clientName: req.body?.clientName ?? null,
      botUserId: req.body?.botUserId ?? null,
      email: req.body?.email ?? null,
      onboardingPayload: req.body ?? null,
    });

    const result = await provisionTenantAndCreateCustomer(req.body);
    const responseBody = {
      status: result.operation,
      message: result.operation === 'updated'
        ? 'Existing onboarding details updated successfully in master registry.'
        : 'Onboarding details saved successfully in master registry.',
      tenantId: result.tenantId,
      tenantDatabase: result.databaseName,
      inv_customer_id: result.inventorySync?.invCustomerId || null,
      inventorySync: result.inventorySync,
    };

    logControllerStep(req, 'Onboarding create completed', {
      statusCode: 201,
      operation: result.operation,
      tenantId: result.tenantId,
      databaseName: result.databaseName,
    });

    return res.status(201).json(responseBody);
  } catch (error) {
    next(error);
  }
}

export async function getExistingOnboardingRequest(req, res, next) {
  try {
    logControllerStep(req, 'Existing onboarding lookup started', {
      botUserId: req.body?.botUserId ?? null,
      botMasterKeyPresent: Boolean(req.body?.botMasterKey),
    });

    const result = await fetchExistingOnboarding(req.body);

    if (!result?.payload) {
      const responseBody = {
        status: 'not_found',
        message: 'No existing client onboarding data was found for this bot key.',
        editMode: false,
        planConfig: result?.planConfig,
      };

      logControllerStep(req, 'Existing onboarding lookup completed', {
        statusCode: 200,
        editMode: false,
        responseStatus: responseBody.status,
        responseMessage: responseBody.message,
      });

      return res.status(200).json(responseBody);
    }

    const responseBody = {
      status: 'ok',
      message: 'Existing client onboarding data loaded. You are now in edit mode.',
      editMode: true,
      tenantId: result.tenantId,
      tenantDatabase: result.databaseName,
      planConfig: result.planConfig,
      payload: result.payload,
    };

    logControllerStep(req, 'Existing onboarding lookup completed', {
      statusCode: 200,
      editMode: true,
      tenantId: result.tenantId,
      databaseName: result.databaseName,
    });

    return res.status(200).json(responseBody);
  } catch (error) {
    next(error);
  }
}

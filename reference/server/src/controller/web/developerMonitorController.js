import { sendSuccess } from './shared/controllerUtils.js';
import {
  getDeveloperMonitorCollectionDocuments,
  deleteDeveloperMonitorCollections,
  createDeveloperMonitorCollection,
  insertDeveloperMonitorDocument,
  updateDeveloperMonitorDocument,
  deleteDeveloperMonitorDocument,
  getDeveloperMonitorLogs,
  getDeveloperMonitorOverview,
} from '../../services/developerMonitorService.js';

export async function getDeveloperMonitorOverviewRequest(req, res, next) {
  try {
    const result = await getDeveloperMonitorOverview({
      query: req.query,
    });

    return sendSuccess(res, 200, 'Developer monitor overview loaded successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function createDeveloperMonitorCollectionRequest(req, res, next) {
  try {
    const result = await createDeveloperMonitorCollection({ query: req.query, scope: req.params.scope, collectionName: req.body?.collectionName });
    return sendSuccess(res, 201, 'Collection created successfully.', result);
  } catch (error) { next(error); }
}

export async function insertDeveloperMonitorDocumentRequest(req, res, next) {
  try {
    const result = await insertDeveloperMonitorDocument({ query: req.query, scope: req.params.scope, collectionName: req.params.collectionName, document: req.body?.document });
    return sendSuccess(res, 201, 'Document inserted successfully.', result);
  } catch (error) { next(error); }
}

export async function updateDeveloperMonitorDocumentRequest(req, res, next) {
  try {
    const result = await updateDeveloperMonitorDocument({ query: req.query, scope: req.params.scope, collectionName: req.params.collectionName, documentId: req.params.documentId, document: req.body?.document });
    return sendSuccess(res, 200, 'Document updated successfully.', result);
  } catch (error) { next(error); }
}

export async function deleteDeveloperMonitorDocumentRequest(req, res, next) {
  try {
    const result = await deleteDeveloperMonitorDocument({ query: req.query, scope: req.params.scope, collectionName: req.params.collectionName, documentId: req.params.documentId });
    return sendSuccess(res, 200, 'Document deleted successfully.', result);
  } catch (error) { next(error); }
}

export async function getDeveloperMonitorLogsRequest(req, res, next) {
  try {
    const result = getDeveloperMonitorLogs({
      query: req.query,
    });

    return sendSuccess(res, 200, 'Developer monitor logs loaded successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function getDeveloperMonitorCollectionDocumentsRequest(req, res, next) {
  try {
    const result = await getDeveloperMonitorCollectionDocuments({
      query: req.query,
      scope: req.params.scope,
      collectionName: req.params.collectionName,
    });

    return sendSuccess(res, 200, 'Developer monitor collection preview loaded successfully.', result);
  } catch (error) {
    next(error);
  }
}

export async function deleteDeveloperMonitorCollectionsRequest(req, res, next) {
  try {
    const result = await deleteDeveloperMonitorCollections({
      query: req.query,
      scope: req.params.scope,
      collectionNames: req.body?.collectionNames,
      confirmationNames: req.body?.confirmationNames,
    });

    return sendSuccess(res, 200, 'Selected collections were deleted successfully.', result);
  } catch (error) {
    next(error);
  }
}

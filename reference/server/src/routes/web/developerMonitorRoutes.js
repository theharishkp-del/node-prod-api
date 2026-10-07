import { Router } from 'express';
import { developerMonitorAuth } from '../../middleware/developerMonitorAuthMiddleware.js';
import {
  getDeveloperMonitorCollectionDocumentsRequest,
  deleteDeveloperMonitorCollectionsRequest,
  createDeveloperMonitorCollectionRequest,
  insertDeveloperMonitorDocumentRequest,
  updateDeveloperMonitorDocumentRequest,
  deleteDeveloperMonitorDocumentRequest,
  getDeveloperMonitorLogsRequest,
  getDeveloperMonitorOverviewRequest,
} from '../../controller/web/developerMonitorController.js';

const router = Router();

router.use(developerMonitorAuth);
router.get('/overview', getDeveloperMonitorOverviewRequest);
router.get('/logs', getDeveloperMonitorLogsRequest);
router.get('/collections/:scope/:collectionName', getDeveloperMonitorCollectionDocumentsRequest);
router.delete('/collections/:scope', deleteDeveloperMonitorCollectionsRequest);
router.post('/collections/:scope', createDeveloperMonitorCollectionRequest);
router.post('/collections/:scope/:collectionName/documents', insertDeveloperMonitorDocumentRequest);
router.patch('/collections/:scope/:collectionName/documents/:documentId', updateDeveloperMonitorDocumentRequest);
router.delete('/collections/:scope/:collectionName/documents/:documentId', deleteDeveloperMonitorDocumentRequest);

export default router;

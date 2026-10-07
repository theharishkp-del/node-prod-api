import crypto from 'node:crypto';
import { getMasterDbConnection } from '../config/db.js';
import { env } from '../config/env.js';

const COLLECTION = 'customer_cart_selection_links';
const TTL_MS = 24 * 60 * 60 * 1000;

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function isBookingComplete(state = {}) {
  const artifacts = state?.orderSummaryState?.artifacts || {};
  return state?.orderSummaryState?.status === 'confirmed'
    && Boolean(artifacts.invoice?.url || artifacts.paymentLink?.url);
}

function isOrderLocked(state = {}) {
  const summary = state?.orderSummaryState || {};
  const artifacts = summary.artifacts || {};

  return ['confirmed', 'submitted'].includes(String(summary.status || '').toLowerCase())
    || Boolean(artifacts.workOrder || artifacts.coreOrder);
}

function uiStateFromGraph(state = {}) {
  return {
    pendingDecision: state.pendingDecision || null,
    pendingImageConfirmation: state.pendingImageConfirmation || null,
    cart: state.cart || { items: [] },
    orderSummaryState: state.orderSummaryState || null,
    bookingCompleted: isBookingComplete(state),
    orderLocked: isOrderLocked(state),
  };
}

export async function upsertCartSelectionLink({ threadId, agentPayload, graphState }) {
  const masterDb = getMasterDbConnection();
  const now = new Date();
  const uiState = uiStateFromGraph(graphState);
  const filter = { threadId };
  const current = await masterDb.collection(COLLECTION).findOne(filter, { projection: { token: 1 } });
  const token = current?.token || crypto.randomBytes(32).toString('base64url');

  await masterDb.collection(COLLECTION).updateOne(filter, {
    $set: {
      token,
      tokenHash: tokenHash(token),
      agentPayload,
      uiState,
      expiresAt: new Date(now.getTime() + TTL_MS),
      updatedAt: now,
      // A confirmed/submitted order remains informational only. Other bot
      // replies reset the selection UI for the next customer action.
      uiSubmitStatus: uiState.orderLocked ? 'completed' : 'ready',
    },
    $setOnInsert: { threadId, createdAt: now },
  }, { upsert: true });

  return {
    token,
    url: `${String(env.clientUrl || '').replace(/\/$/, '')}/cart-selection?t=${encodeURIComponent(token)}`,
  };
}

export async function getCartSelectionByToken(token) {
  const document = await getMasterDbConnection().collection(COLLECTION).findOne({
    tokenHash: tokenHash(token),
    expiresAt: { $gt: new Date() },
  });
  return document || null;
}

export async function lockCartSelectionForWorkOrder({ threadId, workOrder } = {}) {
  if (!threadId) return;

  await getMasterDbConnection().collection(COLLECTION).updateOne(
    { threadId },
    {
      $set: {
        uiSubmitStatus: 'completed',
        'uiState.orderLocked': true,
        'uiState.orderSummaryState.artifacts.workOrder': {
          status: 'created',
          referenceNumber: workOrder?.workOrderNumber || workOrder?.workOrderId || null,
        },
        updatedAt: new Date(),
      },
    },
  );
}

export async function claimCartSelectionSubmission({ token, message }) {
  const now = new Date();
  const result = await getMasterDbConnection().collection(COLLECTION).findOneAndUpdate(
    {
      tokenHash: tokenHash(token),
      expiresAt: { $gt: now },
      uiSubmitStatus: 'ready',
      'uiState.bookingCompleted': { $ne: true },
      'uiState.orderLocked': { $ne: true },
      'uiState.orderSummaryState.artifacts.workOrder': { $eq: null },
    },
    { $set: { uiSubmitStatus: 'submitted_to_kafka', submittedMessage: message, submittedAt: now, updatedAt: now } },
    { returnDocument: 'after' },
  );
  return result?.value || result || null;
}

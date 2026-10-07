'use strict';

/** @file Fallback handler for question/answer keys that have no handler registered. */
const { EO_STATE } = require('../../../shared/eo');

/**
 * Reply that the step is not configured yet, naming the received keys.
 * @param {object} payload Incoming request body (unused).
 * @param {{questionKey: string, answerKey: string}} decoded
 * @returns {Promise<{fileName: string, eoState: string}>}
 */
async function defaultHandler(payload, decoded) {
  const q = decoded.questionKey || '(empty)';
  const a = decoded.answerKey || '(empty)';
  return {
    fileName: `This step is not configured yet (questionKey: ${q}, answerKey: ${a}).`,
    eoState: EO_STATE.STOP,
  };
}

module.exports = defaultHandler;

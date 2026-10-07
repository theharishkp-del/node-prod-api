'use strict';

const { EO_STATE } = require('../constants');

/** Global fallback for question/answer keys that have no handler registered. */
async function defaultHandler(payload, decoded) {
  const q = decoded.questionKey || '(empty)';
  const a = decoded.answerKey || '(empty)';
  return {
    fileName: `This step is not configured yet (questionKey: ${q}, answerKey: ${a}).`,
    eoState: EO_STATE.STOP,
  };
}

module.exports = defaultHandler;

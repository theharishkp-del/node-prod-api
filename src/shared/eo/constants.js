'use strict';

/**
 * @file EO protocol constants shared by every EO API.
 * The failure values are NOT confirmed by the bot platform yet
 * (TODO: confirm with the platform team) - change them here only.
 */

/** Result codes/texts returned in resultCode / resultText. */
const EO_RESULT = Object.freeze({
  SUCCESS_CODE: '0',
  SUCCESS_TEXT: 'success',
  FAILURE_CODE: '1',
  FAILURE_TEXT: 'failure',
  FAILURE_MESSAGE:
    'Sorry, something went wrong while processing your request. Please try again later.',
});

/** eoState values ('stop' ends the step). Add others here once the platform confirms them. */
const EO_STATE = Object.freeze({ STOP: 'stop' });

module.exports = { EO_RESULT, EO_STATE };

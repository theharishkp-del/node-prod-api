import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTrialBotConfig, buildTrialBotConfig } from './trialBotManagementService.js';

test('accepts explicit start and end dates with min and max user limits', () => {
  const config = {
    botId: 'bot-123',
    noOfDays: 14,
    minUsers: 2,
    maxUsers: 6,
    trialStartDate: '2026-09-10',
    trialEndDate: '2026-09-24',
    trialEndMessage: 'Trial ended',
  };

  const validation = validateTrialBotConfig(config);
  assert.equal(validation.isValid, true, validation.errors.join(', '));

  const built = buildTrialBotConfig(config);
  assert.equal(built.minUsers, 2);
  assert.equal(built.maxUsers, 6);
  assert.equal(new Date(built.trialStartDate).toISOString().slice(0, 10), '2026-09-10');
  assert.equal(new Date(built.trialEndDate).toISOString().slice(0, 10), '2026-09-24');
});

test('rejects invalid min users greater than max users', () => {
  const validation = validateTrialBotConfig({
    botId: 'bot-456',
    noOfDays: 10,
    minUsers: 8,
    maxUsers: 6,
    trialStartDate: '2026-09-01',
    trialEndDate: '2026-09-10',
  });

  assert.equal(validation.isValid, false);
  assert.match(validation.errors.join(', '), /minUsers.*maxUsers|maxUsers.*minUsers/i);
});

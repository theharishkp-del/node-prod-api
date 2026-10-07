import { getMasterDbConnection } from '../config/db.js';
import { logger } from '../config/logger.js';
import { PLAN_MASTER_COLLECTION, TRIAL_PLAN_CODE } from '../models/master/planMasterModel.js';
import { ObjectId } from 'mongodb';

function normalizeText(value) {
  return String(value || '').trim();
}

export function validateTrialBotConfig(botConfig = {}) {
  const errors = [];

  const botId = normalizeText(botConfig.botId);
  if (!botId) {
    errors.push('botId is required and must be a non-empty string');
  }

  const noOfDays = Number(botConfig.noOfDays);
  if (!Number.isInteger(noOfDays) || noOfDays <= 0) {
    errors.push('noOfDays must be a positive integer');
  }

  const minUsers = Number(botConfig.minUsers);
  if (!Number.isInteger(minUsers) || minUsers < 1) {
    errors.push('minUsers must be a positive integer');
  }

  const maxUsers = Number(botConfig.maxUsers);
  if (!Number.isInteger(maxUsers) || maxUsers <= 0) {
    errors.push('maxUsers must be a positive integer');
  }

  if (Number.isInteger(minUsers) && Number.isInteger(maxUsers) && minUsers > maxUsers) {
    errors.push('minUsers cannot be greater than maxUsers');
  }

  const startDate = botConfig.trialStartDate ? new Date(botConfig.trialStartDate) : null;
  if (botConfig.trialStartDate && Number.isNaN(startDate?.getTime?.())) {
    errors.push('trialStartDate must be a valid date');
  }

  const endDate = botConfig.trialEndDate ? new Date(botConfig.trialEndDate) : null;
  if (botConfig.trialEndDate && Number.isNaN(endDate?.getTime?.())) {
    errors.push('trialEndDate must be a valid date');
  }

  if (startDate && endDate && endDate < startDate) {
    errors.push('trialEndDate cannot be earlier than trialStartDate');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export function buildTrialBotConfig(botConfig = {}) {
  return {
    botId: normalizeText(botConfig.botId),
    noOfDays: Number(botConfig.noOfDays) || 14,
    minUsers: Number(botConfig.minUsers) || 1,
    maxUsers: Number(botConfig.maxUsers) || 6,
    trialStartDate: botConfig.trialStartDate ? new Date(botConfig.trialStartDate) : null,
    trialEndDate: botConfig.trialEndDate ? new Date(botConfig.trialEndDate) : null,
    trialEndMessage: normalizeText(botConfig.trialEndMessage || 'Thanks for using the OFA Agent trial. The trial period has ended. Please purchase the OFA Agent in the cart.'),
  };
}

export async function listTrialBots() {
  try {
    const masterDb = getMasterDbConnection();
    const collection = masterDb.collection(PLAN_MASTER_COLLECTION);

    const trialPlan = await collection.findOne({
      planCode: TRIAL_PLAN_CODE,
    });

    if (!trialPlan) {
      return {
        success: false,
        message: `Trial plan ${TRIAL_PLAN_CODE} not found`,
        trials: [],
      };
    }

    const trials = Array.isArray(trialPlan.trial?.trials) ? trialPlan.trial.trials : [];

    return {
      success: true,
      message: `Retrieved ${trials.length} trial bots`,
      trials,
      planCode: trialPlan.planCode,
    };
  } catch (error) {
    logger.error('Error listing trial bots', {
      error: error.message,
      stack: error.stack,
    });

    return {
      success: false,
      message: `Failed to list trial bots: ${error.message}`,
      trials: [],
    };
  }
}

export async function addTrialBot(botConfig = {}) {
  try {
    const validation = validateTrialBotConfig(botConfig);
    if (!validation.isValid) {
      return {
        success: false,
        message: `Invalid trial bot configuration: ${validation.errors.join(', ')}`,
      };
    }

    const masterDb = getMasterDbConnection();
    const collection = masterDb.collection(PLAN_MASTER_COLLECTION);

    const trialPlan = await collection.findOne({
      planCode: TRIAL_PLAN_CODE,
    });

    if (!trialPlan) {
      return {
        success: false,
        message: `Trial plan ${TRIAL_PLAN_CODE} not found. Please ensure the trial plan is seeded.`,
      };
    }

    const trials = Array.isArray(trialPlan.trial?.trials) ? trialPlan.trial.trials : [];
    const botId = normalizeText(botConfig.botId);

    // Check if bot already exists
    const existingBot = trials.find((t) => normalizeText(t.botId) === botId);
    if (existingBot) {
      return {
        success: false,
        message: `Trial bot ${botId} already exists in the trial plan`,
      };
    }

    const newTrialBot = buildTrialBotConfig(botConfig);
    const updatedTrials = [...trials, newTrialBot];

    const result = await collection.updateOne(
      { _id: trialPlan._id },
      {
        $set: {
          'trial.trials': updatedTrials,
          updatedAt: new Date(),
        },
      }
    );

    if (result.modifiedCount === 0) {
      return {
        success: false,
        message: `Failed to add trial bot ${botId} to the plan`,
      };
    }

    logger.info('Trial bot added successfully', {
      botId,
      noOfDays: newTrialBot.noOfDays,
      maxUsers: newTrialBot.maxUsers,
    });

    return {
      success: true,
      message: `Trial bot ${botId} added successfully`,
      trialBot: newTrialBot,
    };
  } catch (error) {
    logger.error('Error adding trial bot', {
      error: error.message,
      stack: error.stack,
    });

    return {
      success: false,
      message: `Failed to add trial bot: ${error.message}`,
    };
  }
}

export async function updateTrialBot(botId, botConfig = {}) {
  try {
    const normalizedBotId = normalizeText(botId);
    if (!normalizedBotId) {
      return {
        success: false,
        message: 'botId is required',
      };
    }

    const masterDb = getMasterDbConnection();
    const collection = masterDb.collection(PLAN_MASTER_COLLECTION);

    const trialPlan = await collection.findOne({
      planCode: TRIAL_PLAN_CODE,
    });

    if (!trialPlan) {
      return {
        success: false,
        message: `Trial plan ${TRIAL_PLAN_CODE} not found`,
      };
    }

    const trials = Array.isArray(trialPlan.trial?.trials) ? trialPlan.trial.trials : [];
    const botIndex = trials.findIndex((t) => normalizeText(t.botId) === normalizedBotId);

    if (botIndex === -1) {
      return {
        success: false,
        message: `Trial bot ${normalizedBotId} not found in the trial plan`,
      };
    }

    const existingBot = trials[botIndex];
    const updatedBot = buildTrialBotConfig({
      ...existingBot,
      ...botConfig,
      botId: existingBot.botId, // Keep original botId
    });

    const updatedTrials = [...trials];
    updatedTrials[botIndex] = updatedBot;

    const result = await collection.updateOne(
      { _id: trialPlan._id },
      {
        $set: {
          'trial.trials': updatedTrials,
          updatedAt: new Date(),
        },
      }
    );

    if (result.modifiedCount === 0) {
      return {
        success: false,
        message: `Failed to update trial bot ${normalizedBotId}`,
      };
    }

    logger.info('Trial bot updated successfully', {
      botId: normalizedBotId,
      noOfDays: updatedBot.noOfDays,
      maxUsers: updatedBot.maxUsers,
    });

    return {
      success: true,
      message: `Trial bot ${normalizedBotId} updated successfully`,
      trialBot: updatedBot,
    };
  } catch (error) {
    logger.error('Error updating trial bot', {
      error: error.message,
      stack: error.stack,
    });

    return {
      success: false,
      message: `Failed to update trial bot: ${error.message}`,
    };
  }
}

export async function removeTrialBot(botId) {
  try {
    const normalizedBotId = normalizeText(botId);
    if (!normalizedBotId) {
      return {
        success: false,
        message: 'botId is required',
      };
    }

    const masterDb = getMasterDbConnection();
    const collection = masterDb.collection(PLAN_MASTER_COLLECTION);

    const trialPlan = await collection.findOne({
      planCode: TRIAL_PLAN_CODE,
    });

    if (!trialPlan) {
      return {
        success: false,
        message: `Trial plan ${TRIAL_PLAN_CODE} not found`,
      };
    }

    const trials = Array.isArray(trialPlan.trial?.trials) ? trialPlan.trial.trials : [];
    const filteredTrials = trials.filter((t) => normalizeText(t.botId) !== normalizedBotId);

    if (filteredTrials.length === trials.length) {
      return {
        success: false,
        message: `Trial bot ${normalizedBotId} not found in the trial plan`,
      };
    }

    const result = await collection.updateOne(
      { _id: trialPlan._id },
      {
        $set: {
          'trial.trials': filteredTrials,
          updatedAt: new Date(),
        },
      }
    );

    if (result.modifiedCount === 0) {
      return {
        success: false,
        message: `Failed to remove trial bot ${normalizedBotId}`,
      };
    }

    logger.info('Trial bot removed successfully', {
      botId: normalizedBotId,
    });

    return {
      success: true,
      message: `Trial bot ${normalizedBotId} removed successfully`,
    };
  } catch (error) {
    logger.error('Error removing trial bot', {
      error: error.message,
      stack: error.stack,
    });

    return {
      success: false,
      message: `Failed to remove trial bot: ${error.message}`,
    };
  }
}

import { logger } from '../../config/logger.js';
import {
  listTrialBots,
  addTrialBot,
  updateTrialBot,
  removeTrialBot,
} from '../../services/trialBotManagementService.js';

export async function handleListTrialBots(req, res, next) {
  try {
    logger.info('Listing trial bots', {
      requestId: req.requestId,
    });

    const result = await listTrialBots();

    if (!result.success) {
      logger.warn('Failed to list trial bots', {
        requestId: req.requestId,
        message: result.message,
      });

      return res.status(400).json({
        success: false,
        message: result.message,
        data: [],
      });
    }

    logger.info('Trial bots listed successfully', {
      requestId: req.requestId,
      count: result.trials.length,
    });

    return res.status(200).json({
      success: true,
      message: result.message,
      data: result.trials,
    });
  } catch (error) {
    logger.error('Error listing trial bots', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });

    return next(error);
  }
}

export async function handleAddTrialBot(req, res, next) {
  try {
    const botConfig = req.body || {};

    logger.info('Adding trial bot', {
      requestId: req.requestId,
      botId: botConfig.botId,
    });

    const result = await addTrialBot(botConfig);

    if (!result.success) {
      logger.warn('Failed to add trial bot', {
        requestId: req.requestId,
        botId: botConfig.botId,
        message: result.message,
      });

      return res.status(400).json({
        success: false,
        message: result.message,
      });
    }

    logger.info('Trial bot added successfully', {
      requestId: req.requestId,
      botId: botConfig.botId,
    });

    return res.status(201).json({
      success: true,
      message: result.message,
      data: result.trialBot,
    });
  } catch (error) {
    logger.error('Error adding trial bot', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });

    return next(error);
  }
}

export async function handleUpdateTrialBot(req, res, next) {
  try {
    const botId = req.params.botId || '';
    const botConfig = req.body || {};

    logger.info('Updating trial bot', {
      requestId: req.requestId,
      botId,
    });

    const result = await updateTrialBot(botId, botConfig);

    if (!result.success) {
      logger.warn('Failed to update trial bot', {
        requestId: req.requestId,
        botId,
        message: result.message,
      });

      return res.status(400).json({
        success: false,
        message: result.message,
      });
    }

    logger.info('Trial bot updated successfully', {
      requestId: req.requestId,
      botId,
    });

    return res.status(200).json({
      success: true,
      message: result.message,
      data: result.trialBot,
    });
  } catch (error) {
    logger.error('Error updating trial bot', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });

    return next(error);
  }
}

export async function handleRemoveTrialBot(req, res, next) {
  try {
    const botId = req.params.botId || '';

    logger.info('Removing trial bot', {
      requestId: req.requestId,
      botId,
    });

    const result = await removeTrialBot(botId);

    if (!result.success) {
      logger.warn('Failed to remove trial bot', {
        requestId: req.requestId,
        botId,
        message: result.message,
      });

      return res.status(400).json({
        success: false,
        message: result.message,
      });
    }

    logger.info('Trial bot removed successfully', {
      requestId: req.requestId,
      botId,
    });

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    logger.error('Error removing trial bot', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });

    return next(error);
  }
}

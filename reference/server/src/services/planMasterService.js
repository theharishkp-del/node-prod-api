import { getMasterDbConnection } from '../config/db.js';
import {
  DEFAULT_PLAN_CODE,
  TRIAL_PLAN_CODE,
  DEFAULT_PLAN_LIMITS,
  TRIAL_PLAN_LIMITS,
  PLAN_MASTER_COLLECTION,
  TRIAL_PLAN_SUFFIX,
  defaultPlanDocument,
  defaultTrialPlanDocument,
} from '../models/master/planMasterModel.js';

function normalizePlanCode(value) {
  const planCode = String(value || '').trim().toLowerCase();
  return planCode || DEFAULT_PLAN_CODE;
}

export function isTrialPlanCode(planCode) {
  return normalizePlanCode(planCode).endsWith(TRIAL_PLAN_SUFFIX);
}

function normalizeLimit(value, fallback) {
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue >= 0 ? parsedValue : fallback;
}

function toPlanConfig(plan = {}) {
  const limits = plan.limits || {};

  return {
    planCode: normalizePlanCode(plan.planCode),
    planName: String(plan.planName || defaultPlanDocument.planName),
    limits: {
      minAdmins: normalizeLimit(limits.minAdmins, DEFAULT_PLAN_LIMITS.minAdmins),
      minTechnicians: normalizeLimit(limits.minTechnicians, DEFAULT_PLAN_LIMITS.minTechnicians),
      maxUsers: normalizeLimit(limits.maxUsers, DEFAULT_PLAN_LIMITS.maxUsers),
    },
  };
}

export async function ensurePlanMasterSeed() {
  const masterDb = getMasterDbConnection();
  const now = new Date();

  // Seed default plan (csm-suite)
  const existingDefaultPlan = await masterDb.collection(PLAN_MASTER_COLLECTION).findOne({
    planCode: DEFAULT_PLAN_CODE,
  });

  if (!existingDefaultPlan) {
    const createdPlan = {
      ...defaultPlanDocument,
      createdAt: now,
      updatedAt: now,
    };

    await masterDb.collection(PLAN_MASTER_COLLECTION).insertOne(createdPlan);
  } else {
    const mergedDefaultPlan = {
      planCode: existingDefaultPlan.planCode || defaultPlanDocument.planCode,
      planName: existingDefaultPlan.planName || defaultPlanDocument.planName,
      isDefault: existingDefaultPlan.isDefault ?? defaultPlanDocument.isDefault,
      isActive: existingDefaultPlan.isActive ?? defaultPlanDocument.isActive,
      limits: {
        ...DEFAULT_PLAN_LIMITS,
        ...(existingDefaultPlan.limits || {}),
      },
      trial: {
        isEnabled: false,
      },
      updatedAt: now,
    };

    await masterDb.collection(PLAN_MASTER_COLLECTION).updateOne(
      { planCode: DEFAULT_PLAN_CODE },
      {
        $set: mergedDefaultPlan,
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    );
  }

  // Seed trial plan (csm-suite-trial)
  const existingTrialPlan = await masterDb.collection(PLAN_MASTER_COLLECTION).findOne({
    planCode: TRIAL_PLAN_CODE,
  });

  if (!existingTrialPlan) {
    const createdTrialPlan = {
      ...defaultTrialPlanDocument,
      createdAt: now,
      updatedAt: now,
    };

    await masterDb.collection(PLAN_MASTER_COLLECTION).insertOne(createdTrialPlan);
  } else {
    const mergedTrialPlan = {
      planCode: existingTrialPlan.planCode || defaultTrialPlanDocument.planCode,
      planName: existingTrialPlan.planName || defaultTrialPlanDocument.planName,
      isDefault: existingTrialPlan.isDefault ?? defaultTrialPlanDocument.isDefault,
      isActive: existingTrialPlan.isActive ?? defaultTrialPlanDocument.isActive,
      limits: {
        ...TRIAL_PLAN_LIMITS,
        ...(existingTrialPlan.limits || {}),
      },
      trial: {
        isEnabled: true,
        trials: Array.isArray(existingTrialPlan.trial?.trials) ? existingTrialPlan.trial.trials : [],
      },
      updatedAt: now,
    };

    await masterDb.collection(PLAN_MASTER_COLLECTION).updateOne(
      { planCode: TRIAL_PLAN_CODE },
      {
        $set: mergedTrialPlan,
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    );
  }
}

export async function getOrCreatePlanConfig(planCode) {
  const masterDb = getMasterDbConnection();
  const requestedPlanCode = normalizePlanCode(planCode);

  await ensurePlanMasterSeed();

  const requestedPlan = await masterDb.collection(PLAN_MASTER_COLLECTION).findOne({
    planCode: requestedPlanCode,
  });
  const plan = requestedPlan || await masterDb.collection(PLAN_MASTER_COLLECTION).findOne({
    planCode: DEFAULT_PLAN_CODE,
  });

  if (!plan?.isActive) {
    throw new Error(`The ${plan?.planCode || DEFAULT_PLAN_CODE} plan is not active.`);
  }

  return toPlanConfig(plan);
}

export async function getTrialStatusForBot(botUserId) {
  const normalizedBotUserId = String(botUserId || '').trim();

  if (!normalizedBotUserId) {
    return null;
  }

  const masterDb = getMasterDbConnection();
  const collection = masterDb.collection(PLAN_MASTER_COLLECTION);

  // Find the trial plan
  const trialPlan = await collection.findOne({
    planCode: TRIAL_PLAN_CODE,
    isActive: { $ne: false },
    'trial.isEnabled': { $ne: false },
  });

  if (!trialPlan) {
    return null;
  }

  // Search within trials array for matching botId
  const trials = Array.isArray(trialPlan.trial?.trials) ? trialPlan.trial.trials : [];
  let trialConfig = trials.find((t) => String(t.botId || '').trim() === normalizedBotUserId);

  if (!trialConfig) {
    return null;
  }

  const trialDays = Number.isInteger(Number(trialConfig.noOfDays)) && Number(trialConfig.noOfDays) >= 0
    ? Number(trialConfig.noOfDays)
    : 14;

  const existingStartDate = trialConfig.trialStartDate ? new Date(trialConfig.trialStartDate) : null;
  let startDate = existingStartDate && !Number.isNaN(existingStartDate.getTime()) ? existingStartDate : null;

  if (!startDate || Number.isNaN(startDate.getTime())) {
    startDate = new Date();
    const updatedTrials = trials.map((t) =>
      String(t.botId || '').trim() === normalizedBotUserId
        ? { ...t, trialStartDate: startDate, trialEndDate: new Date(startDate.getTime() + trialDays * 24 * 60 * 60 * 1000) }
        : t
    );

    await collection.updateOne(
      { _id: trialPlan._id },
      {
        $set: {
          'trial.trials': updatedTrials,
        },
      }
    );
  }

  let endDate = trialConfig.trialEndDate ? new Date(trialConfig.trialEndDate) : null;

  if (!endDate || Number.isNaN(endDate.getTime())) {
    endDate = new Date((startDate || new Date()).getTime() + trialDays * 24 * 60 * 60 * 1000);
    const updatedTrials = trials.map((t) =>
      String(t.botId || '').trim() === normalizedBotUserId
        ? { ...t, trialEndDate: endDate }
        : t
    );

    await collection.updateOne(
      { _id: trialPlan._id },
      {
        $set: {
          'trial.trials': updatedTrials,
        },
      }
    );
  }

  const trialEndMessage = String(
    trialConfig.trialEndMessage || 'Thanks for using the OFA Agent trial. The trial period has ended. Please purchase the OFA Agent in the cart.'
  ).trim();

  return {
    isExpired: new Date() >= endDate,
    startDate,
    endDate,
    trialDays,
    maxUsers: trialConfig.maxUsers || 6,
    trialEndMessage,
    planCode: trialPlan.planCode || TRIAL_PLAN_CODE,
  };
}

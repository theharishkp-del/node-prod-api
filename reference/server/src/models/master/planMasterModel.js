export const PLAN_MASTER_COLLECTION = 'sma_plan_master';

export const DEFAULT_PLAN_CODE = 'csm-suite';
export const TRIAL_PLAN_CODE = 'csm-suite-trial';
export const TRIAL_PLAN_SUFFIX = '-trial';

export const DEFAULT_PLAN_LIMITS = {
  minAdmins: 1,
  minTechnicians: 1,
  maxUsers: 3,
};

export const TRIAL_PLAN_LIMITS = {
  minAdmins: 1,
  minTechnicians: 1,
  maxUsers: 6,
};

export const DEFAULT_TRIAL_BOT_CONFIG = {
  botId: '',
  noOfDays: 14,
  maxUsers: 6,
  trialStartDate: null,
  trialEndDate: null,
  trialEndMessage: 'Thanks for using the OFA Agent trial. The trial period has ended. Please purchase the OFA Agent in the cart.',
};

export const defaultPlanDocument = {
  planCode: DEFAULT_PLAN_CODE,
  planName: 'CSM Suite',
  isDefault: true,
  isActive: true,
  limits: DEFAULT_PLAN_LIMITS,
  trial: {
    isEnabled: false,
  },
};

export const defaultTrialPlanDocument = {
  planCode: TRIAL_PLAN_CODE,
  planName: 'CSM Suite Trial',
  isDefault: false,
  isActive: true,
  limits: TRIAL_PLAN_LIMITS,
  trial: {
    isEnabled: true,
    trials: [],
  },
};
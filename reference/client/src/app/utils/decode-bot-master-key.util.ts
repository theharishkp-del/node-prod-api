import { BotMasterKeyValue } from '../models/onboarding.models';

export function decodeBotMasterKey(encodedKey: string): BotMasterKeyValue {
  try {
    const json = atob(encodedKey);
    const parsed = JSON.parse(json);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Decoded key is not a valid object.');
    }

    return parsed as BotMasterKeyValue;
  } catch (error) {
    throw new Error(`Unable to decode bot master key: ${(error as Error).message}`);
  }
}

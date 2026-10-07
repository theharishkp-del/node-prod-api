import { Injectable, signal } from '@angular/core';
import { BotMasterKeyValue } from '../models/onboarding.models';
import { decodeBotMasterKey } from '../utils/decode-bot-master-key.util';

@Injectable({ providedIn: 'root' })
export class BotMasterKeyService {
  private readonly botMasterKeySignal = signal<BotMasterKeyValue | null>(null);

  readonly botMasterKey = this.botMasterKeySignal.asReadonly();

  initializeFromEncodedKey(encodedKey: string | null): BotMasterKeyValue | null {
    if (!encodedKey) {
      return this.botMasterKeySignal();
    }

    const decodedValue = decodeBotMasterKey(encodedKey);
    this.botMasterKeySignal.set(decodedValue);
    return decodedValue;
  }

  setBotMasterKey(value: BotMasterKeyValue | null): void {
    this.botMasterKeySignal.set(value);
  }
}

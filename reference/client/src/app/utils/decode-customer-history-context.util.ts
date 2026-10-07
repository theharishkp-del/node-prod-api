import { CustomerHistoryContext } from '../features/master-data/shared/master-data.types';

export function decodeCustomerHistoryContext(encodedValue: string): CustomerHistoryContext {
  try {
    const json = atob(encodedValue);
    const parsed = JSON.parse(json);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Decoded customer context is not a valid object.');
    }

    return parsed as CustomerHistoryContext;
  } catch (error) {
    throw new Error(`Unable to decode customer history context: ${(error as Error).message}`);
  }
}

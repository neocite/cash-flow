import { BalanceDelta, DailyBalance } from '../domain/daily-balance';

export interface BalanceRepository {
  /**
   * Applies the delta idempotently (records the eventId and updates the balance
   * in the same transaction). Returns false if the event was already applied.
   */
  apply(delta: BalanceDelta): Promise<boolean>;
  findRange(merchantId: string, from: string, to: string): Promise<DailyBalance[]>;
}

export const BALANCE_REPOSITORY = Symbol('BALANCE_REPOSITORY');

import { Inject, Injectable } from '@nestjs/common';
import { parseEvent } from '../domain/daily-balance';
import { eventsProcessed } from '../shared/metrics';
import { BALANCE_REPOSITORY, BalanceRepository } from './ports';

@Injectable()
export class ApplyEntryUseCase {
  constructor(@Inject(BALANCE_REPOSITORY) private readonly repo: BalanceRepository) {}

  /** Throws InvalidEventError (not retryable) or infrastructure errors (retryable). */
  async execute(rawEvent: unknown): Promise<'applied' | 'duplicate'> {
    const delta = parseEvent(rawEvent);
    const applied = await this.repo.apply(delta);
    const outcome = applied ? 'applied' : 'duplicate';
    eventsProcessed.inc({ outcome });
    return outcome;
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { Entry } from '../domain/entry';
import { isValidDate } from '../shared/business-date';
import { DomainError } from '../shared/errors';
import { ENTRY_REPOSITORY, EntryRepository } from './ports';

@Injectable()
export class ListEntriesUseCase {
  constructor(@Inject(ENTRY_REPOSITORY) private readonly repo: EntryRepository) {}

  byId(merchantId: string, id: string): Promise<Entry | null> {
    return this.repo.findById(merchantId, id);
  }

  async byDate(merchantId: string, date: string, limit = 50, afterId?: string) {
    if (!isValidDate(date)) {
      throw new DomainError('INVALID_DATE', 'Date must be in YYYY-MM-DD format');
    }
    const size = Math.min(Math.max(limit, 1), 200);
    const items = await this.repo.listByDate(merchantId, date, size, afterId);
    return {
      items,
      nextCursor: items.length === size ? items[items.length - 1].id : null,
    };
  }
}

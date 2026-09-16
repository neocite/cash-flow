import { Inject, Injectable } from '@nestjs/common';
import { Entry, NewEntry } from '../domain/entry';
import { CONFIG, Config } from '../shared/config';
import { DuplicateIdempotencyKeyError } from '../shared/errors';
import { entriesRecorded } from '../shared/metrics';
import { CLOCK, Clock, ENTRY_REPOSITORY, EntryRepository } from './ports';

export interface RecordResult {
  entry: Entry;
  /** false when the request is an idempotent replay */
  created: boolean;
}

@Injectable()
export class RecordEntryUseCase {
  constructor(
    @Inject(ENTRY_REPOSITORY) private readonly repo: EntryRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  async execute(cmd: NewEntry): Promise<RecordResult> {
    if (cmd.idempotencyKey) {
      const existing = await this.repo.findByIdempotencyKey(cmd.merchantId, cmd.idempotencyKey);
      if (existing) return { entry: existing, created: false };
    }

    const entry = Entry.create(cmd, this.clock.now(), this.cfg.timezone);
    try {
      await this.repo.saveWithEvent(entry, entry.toEvent());
    } catch (e) {
      // Race between two requests with the same key: the unique index settles it.
      if (e instanceof DuplicateIdempotencyKeyError && cmd.idempotencyKey) {
        const existing = await this.repo.findByIdempotencyKey(cmd.merchantId, cmd.idempotencyKey);
        if (existing) return { entry: existing, created: false };
      }
      throw e;
    }
    entriesRecorded.inc({ type: entry.type });
    return { entry, created: true };
  }
}

import { Counter, collectDefaultMetrics, register } from 'prom-client';

collectDefaultMetrics({ prefix: 'entries_' });

export const entriesRecorded = new Counter({
  name: 'entries_recorded_total',
  help: 'Entries recorded, by type',
  labelNames: ['type'],
});

export const outboxPublished = new Counter({
  name: 'outbox_events_published_total',
  help: 'Events published to the broker by the outbox relay',
});

export const outboxFailures = new Counter({
  name: 'outbox_publish_failures_total',
  help: 'Failures publishing outbox events (will be retried)',
});

export { register };

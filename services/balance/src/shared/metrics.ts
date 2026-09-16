import { Counter, collectDefaultMetrics, register } from 'prom-client';

collectDefaultMetrics({ prefix: 'balance_' });

export const eventsProcessed = new Counter({
  name: 'balance_events_processed_total',
  help: 'Entry events consumed, by outcome',
  labelNames: ['outcome'], // applied | duplicate | discarded
});

export { register };

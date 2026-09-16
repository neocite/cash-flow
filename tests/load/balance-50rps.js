// Load test for the NFR: 50 req/s on the balance service with at most 5% loss.
// Usage: TOKEN=$(node scripts/generate-token.mjs) k6 run tests/load/balance-50rps.js
import http from 'k6/http';
import { check } from 'k6';

const TOKEN = __ENV.TOKEN;
const BALANCE = __ENV.BALANCE_URL || 'http://localhost:3001';
const ENTRIES = __ENV.ENTRIES_URL || 'http://localhost:3000';
const TODAY = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); // UTC-3

export const options = {
  scenarios: {
    // Read peak: a steady 50 req/s, ramping to 2x in the last stage
    balance_reads: {
      executor: 'ramping-arrival-rate',
      exec: 'readBalance',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 200,
      stages: [
        { target: 50, duration: '30s' },
        { target: 50, duration: '2m' },
        { target: 100, duration: '1m' },
      ],
    },
    // Concurrent writes, to show that the balance load does not degrade the entries
    entry_writes: {
      executor: 'constant-arrival-rate',
      exec: 'recordEntry',
      rate: 20,
      timeUnit: '1s',
      duration: '3m30s',
      preAllocatedVUs: 20,
    },
  },
  thresholds: {
    'http_req_failed{scenario:balance_reads}': ['rate<0.05'], // NFR: at most 5% loss
    'http_req_duration{scenario:balance_reads}': ['p(95)<200'],
    'http_req_failed{scenario:entry_writes}': ['rate<0.01'],
  },
};

const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

export function readBalance() {
  const r = http.get(`${BALANCE}/v1/balance/daily?date=${TODAY}`, { headers });
  check(r, { 'status 200': (x) => x.status === 200 });
}

export function recordEntry() {
  const type = Math.random() < 0.6 ? 'CREDIT' : 'DEBIT';
  const r = http.post(
    `${ENTRIES}/v1/entries`,
    JSON.stringify({ type, amountCents: Math.ceil(Math.random() * 10000), description: 'k6' }),
    { headers },
  );
  check(r, { 'status 201': (x) => x.status === 201 });
}

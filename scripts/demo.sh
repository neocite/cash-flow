#!/usr/bin/env bash
# End-to-end flow: records entries and reads the daily balance.
set -euo pipefail
cd "$(dirname "$0")/.."
TOKEN=$(node scripts/generate-token.mjs merchant-demo)
TODAY=$(TZ=America/Sao_Paulo date +%F)
ENTRIES=http://localhost:3000
BALANCE=http://localhost:3001

record() {
  curl -sS -X POST "$ENTRIES/v1/entries" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -H "Idempotency-Key: $1" -d "$2"; echo
}

echo "== Recording entries"
record demo-sale-0001 '{"type":"CREDIT","amountCents":15000,"description":"Counter sale"}'
record demo-sale-0002 '{"type":"CREDIT","amountCents":4990,"description":"PIX sale"}'
record demo-supp-0001 '{"type":"DEBIT","amountCents":7500,"description":"Supplier"}'
echo "== Idempotent replay (does not duplicate)"
record demo-sale-0001 '{"type":"CREDIT","amountCents":15000,"description":"Counter sale"}'

echo "== Waiting for async propagation"; sleep 2
echo "== Balance for $TODAY (expected 12490)"
curl -sS "$BALANCE/v1/balance/daily?date=$TODAY" -H "Authorization: Bearer $TOKEN"; echo

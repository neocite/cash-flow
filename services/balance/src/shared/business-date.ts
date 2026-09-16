const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/** Converts an instant to the business date (YYYY-MM-DD) in the merchant's timezone. */
export function businessDate(instant: Date, timezone: string): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

export function isValidDate(value: string): boolean {
  if (!DATE_FORMAT.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

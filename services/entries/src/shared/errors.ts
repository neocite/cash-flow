/** Domain errors map to 422 at the HTTP edge. */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

/** Unique index violation on idempotency (merchant + key). */
export class DuplicateIdempotencyKeyError extends Error {
  constructor() {
    super('Idempotency key already used');
    this.name = 'DuplicateIdempotencyKeyError';
  }
}

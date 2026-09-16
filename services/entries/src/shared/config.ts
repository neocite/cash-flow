/**
 * 12-factor config: everything comes from environment variables.
 * In production, secrets (JWT, credentials) are injected by Secret Manager.
 */
export type RunMode = 'api' | 'relay' | 'all';

export const config = () => ({
  port: Number(process.env.PORT ?? 3000),
  mode: (process.env.MODE ?? 'all') as RunMode,
  mongo: {
    uri: process.env.MONGO_URI ?? 'mongodb://localhost:27017/?replicaSet=rs0',
    database: process.env.MONGO_DB ?? 'entries',
  },
  pubsub: {
    projectId: process.env.GOOGLE_CLOUD_PROJECT ?? 'cashflow-local',
    topic: process.env.PUBSUB_TOPIC ?? 'entries.recorded.v1',
  },
  relay: {
    intervalMs: Number(process.env.RELAY_INTERVAL_MS ?? 500),
    batchSize: Number(process.env.RELAY_BATCH_SIZE ?? 100),
    lockMs: Number(process.env.RELAY_LOCK_MS ?? 30000),
  },
  auth: {
    // Local: HS256 with a shared secret. Target: RS256 via the Identity Platform JWKS.
    secret: process.env.JWT_SECRET ?? 'dev-secret-do-not-use-in-production',
    issuer: process.env.JWT_ISSUER ?? 'cashflow-local',
    audience: process.env.JWT_AUDIENCE ?? 'cashflow-api',
  },
  timezone: process.env.BUSINESS_TZ ?? 'America/Sao_Paulo',
});

export type Config = ReturnType<typeof config>;
export const CONFIG = Symbol('CONFIG');

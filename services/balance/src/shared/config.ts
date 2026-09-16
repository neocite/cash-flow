/** 12-factor config. */
export type RunMode = 'api' | 'worker' | 'all';

export const config = () => ({
  port: Number(process.env.PORT ?? 3001),
  mode: (process.env.MODE ?? 'all') as RunMode,
  mongo: {
    uri: process.env.MONGO_URI ?? 'mongodb://localhost:27017/?replicaSet=rs0',
    database: process.env.MONGO_DB ?? 'balance',
  },
  pubsub: {
    projectId: process.env.GOOGLE_CLOUD_PROJECT ?? 'cashflow-local',
    topic: process.env.PUBSUB_TOPIC ?? 'entries.recorded.v1',
    subscription: process.env.PUBSUB_SUBSCRIPTION ?? 'daily-balance',
    maxConcurrent: Number(process.env.PUBSUB_MAX_CONCURRENT ?? 50),
  },
  query: {
    maxDays: Number(process.env.MAX_RANGE_DAYS ?? 31),
  },
  auth: {
    secret: process.env.JWT_SECRET ?? 'dev-secret-do-not-use-in-production',
    issuer: process.env.JWT_ISSUER ?? 'cashflow-local',
    audience: process.env.JWT_AUDIENCE ?? 'cashflow-api',
  },
});

export type Config = ReturnType<typeof config>;
export const CONFIG = Symbol('CONFIG');

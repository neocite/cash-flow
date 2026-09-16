#!/usr/bin/env node
// Generates a development HS256 JWT (no dependencies).
// Usage: node scripts/generate-token.mjs [merchantId] [scopes]
import { createHmac } from 'node:crypto';

const sub = process.argv[2] ?? 'merchant-demo';
const scope = process.argv[3] ?? 'entries:write entries:read balance:read';
const secret = process.env.JWT_SECRET ?? 'dev-secret-do-not-use-in-production';
const now = Math.floor(Date.now() / 1000);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const header = b64({ alg: 'HS256', typ: 'JWT' });
const payload = b64({
  sub,
  scope,
  iss: process.env.JWT_ISSUER ?? 'cashflow-local',
  aud: process.env.JWT_AUDIENCE ?? 'cashflow-api',
  iat: now,
  exp: now + 3600,
});
const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
process.stdout.write(`${header}.${payload}.${signature}\n`);

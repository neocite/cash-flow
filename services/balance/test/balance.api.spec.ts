import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ApplyEntryUseCase } from '../src/application/apply-entry.usecase';
import { BALANCE_REPOSITORY } from '../src/application/ports';
import { MongoProvider } from '../src/infra/mongo/mongo.provider';
import { config } from '../src/shared/config';
import { event, InMemoryBalanceRepository } from './fakes';

const cfg = config();
const token = (sub: string, scope: string) =>
  `Bearer ${jwt.sign({ scope }, cfg.auth.secret, { subject: sub, issuer: cfg.auth.issuer, audience: cfg.auth.audience, expiresIn: '5m' })}`;

describe('API /v1/balance/daily', () => {
  let app: INestApplication;
  const repo = new InMemoryBalanceRepository();
  const read = token('m1', 'balance:read');

  beforeAll(async () => {
    process.env.MODE = 'api';
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MongoProvider)
      .useValue({ ping: async () => true })
      .overrideProvider(BALANCE_REPOSITORY)
      .useValue(repo)
      .compile();
    app = mod.createNestApplication();
    await app.listen(0);
    const apply = app.get(ApplyEntryUseCase);
    await apply.execute(event('CREDIT', 5_000));
    await apply.execute(event('DEBIT', 1_200));
  });
  afterAll(() => app.close());

  it('401 without a token and 403 without the scope', async () => {
    await request(app.getHttpServer()).get('/v1/balance/daily?date=2026-09-16').expect(401);
    await request(app.getHttpServer())
      .get('/v1/balance/daily?date=2026-09-16')
      .set('Authorization', token('m1', 'entries:write'))
      .expect(403);
  });

  it('returns the balance of a day', async () => {
    const r = await request(app.getHttpServer())
      .get('/v1/balance/daily?date=2026-09-16')
      .set('Authorization', read)
      .expect(200);
    expect(r.headers['cache-control']).toContain('max-age=5');
    expect(r.body.days[0]).toMatchObject({ date: '2026-09-16', balanceCents: 3_800, entryCount: 2 });
  });

  it('returns a range', async () => {
    const r = await request(app.getHttpServer())
      .get('/v1/balance/daily?from=2026-09-15&to=2026-09-16')
      .set('Authorization', read)
      .expect(200);
    expect(r.body.days).toHaveLength(2);
    expect(r.body.totals.balanceCents).toBe(3_800);
  });

  it('does not expose another merchant data', async () => {
    const r = await request(app.getHttpServer())
      .get('/v1/balance/daily?date=2026-09-16')
      .set('Authorization', token('m2', 'balance:read'))
      .expect(200);
    expect(r.body.days[0].balanceCents).toBe(0);
  });

  it('400/422 for invalid parameters', async () => {
    await request(app.getHttpServer()).get('/v1/balance/daily').set('Authorization', read).expect(400);
    await request(app.getHttpServer()).get('/v1/balance/daily?date=16-09-2026').set('Authorization', read).expect(422);
    await request(app.getHttpServer())
      .get('/v1/balance/daily?from=2026-01-01&to=2026-12-31')
      .set('Authorization', read)
      .expect(422);
  });

  it('handles a burst of concurrent reads (sanity check for 50 req/s)', async () => {
    const url = await app.getUrl();
    const responses = await Promise.all(
      Array.from({ length: 100 }, () => request(url).get('/v1/balance/daily?date=2026-09-16').set('Authorization', read)),
    );
    expect(responses.filter((r) => r.status === 200)).toHaveLength(100);
  });

  it('health readiness in api mode', async () => {
    const r = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(r.body.status).toBe('ok');
  });
});

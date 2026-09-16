import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ENTRY_REPOSITORY, EVENT_PUBLISHER, OUTBOX_REPOSITORY } from '../src/application/ports';
import { MongoProvider } from '../src/infra/mongo/mongo.provider';
import { config } from '../src/shared/config';
import { FakePublisher, InMemoryRepository } from './fakes';

const cfg = config();
const token = (sub: string, scope: string) =>
  jwt.sign({ scope }, cfg.auth.secret, { subject: sub, issuer: cfg.auth.issuer, audience: cfg.auth.audience, expiresIn: '5m' });

describe('API /v1/entries', () => {
  let app: INestApplication;
  const repo = new InMemoryRepository();
  const write = `Bearer ${token('merchant-1', 'entries:write entries:read')}`;

  beforeAll(async () => {
    process.env.MODE = 'api';
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MongoProvider)
      .useValue({ ping: async () => true })
      .overrideProvider(ENTRY_REPOSITORY)
      .useValue(repo)
      .overrideProvider(OUTBOX_REPOSITORY)
      .useValue(repo)
      .overrideProvider(EVENT_PUBLISHER)
      .useValue(new FakePublisher())
      .compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  it('401 without a token', () => request(app.getHttpServer()).post('/v1/entries').send({}).expect(401));

  it('401 with a token signed by another secret', () =>
    request(app.getHttpServer())
      .post('/v1/entries')
      .set('Authorization', `Bearer ${jwt.sign({ sub: 'x' }, 'another')}`)
      .expect(401));

  it('403 without the write scope', () =>
    request(app.getHttpServer())
      .post('/v1/entries')
      .set('Authorization', `Bearer ${token('merchant-1', 'entries:read')}`)
      .send({ type: 'CREDIT', amountCents: 100 })
      .expect(403));

  it('400 for a malformed payload', () =>
    request(app.getHttpServer())
      .post('/v1/entries')
      .set('Authorization', write)
      .send({ type: 'CREDIT', amountCents: '10.00' })
      .expect(400)
      .expect('Content-Type', /problem\+json/));

  it('422 for a business rule violation', async () => {
    const r = await request(app.getHttpServer())
      .post('/v1/entries')
      .set('Authorization', write)
      .send({ type: 'CREDIT', amountCents: -1 })
      .expect(422);
    expect(r.body.code).toBe('INVALID_AMOUNT');
  });

  it('201 on create, 200 on idempotent replay, then reads by id and by date', async () => {
    const create = () =>
      request(app.getHttpServer())
        .post('/v1/entries')
        .set('Authorization', write)
        .set('Idempotency-Key', 'sale-000001')
        .send({ type: 'CREDIT', amountCents: 2590, description: 'Counter sale' });

    const r1 = await create().expect(201);
    expect(r1.headers.location).toBe(`/v1/entries/${r1.body.id}`);
    const r2 = await create().expect(200);
    expect(r2.headers['idempotent-replayed']).toBe('true');
    expect(r2.body.id).toBe(r1.body.id);

    await request(app.getHttpServer()).get(`/v1/entries/${r1.body.id}`).set('Authorization', write).expect(200);
    const list = await request(app.getHttpServer())
      .get(`/v1/entries?date=${r1.body.entryDate}`)
      .set('Authorization', write)
      .expect(200);
    expect(list.body.items).toHaveLength(1);
  });

  it('isolates merchants: another merchant does not see the entry (404)', async () => {
    const r = await request(app.getHttpServer())
      .post('/v1/entries')
      .set('Authorization', write)
      .send({ type: 'DEBIT', amountCents: 100 })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/v1/entries/${r.body.id}`)
      .set('Authorization', `Bearer ${token('merchant-2', 'entries:read')}`)
      .expect(404);
  });

  it('health and metrics', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200);
    await request(app.getHttpServer()).get('/health/ready').expect(200);
    const m = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(m.text).toContain('entries_recorded_total');
  });
});

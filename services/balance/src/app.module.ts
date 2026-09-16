import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { BalanceController } from './api/balance.controller';
import { HealthController } from './api/health.controller';
import { ProblemDetailsFilter } from './api/http-exception.filter';
import { ApplyEntryUseCase } from './application/apply-entry.usecase';
import { GetBalanceUseCase } from './application/get-balance.usecase';
import { BALANCE_REPOSITORY } from './application/ports';
import { PubSubSubscriberService } from './infra/pubsub/pubsub-subscriber.service';
import { MongoBalanceRepository } from './infra/mongo/mongo-balance.repository';
import { MongoProvider } from './infra/mongo/mongo.provider';
import { CONFIG, config } from './shared/config';

@Module({
  controllers: [BalanceController, HealthController],
  providers: [
    { provide: CONFIG, useFactory: config },
    MongoProvider,
    { provide: BALANCE_REPOSITORY, useClass: MongoBalanceRepository },
    ApplyEntryUseCase,
    GetBalanceUseCase,
    PubSubSubscriberService,
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}

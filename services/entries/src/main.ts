import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { config } from './shared/config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Structured JSON logs (Cloud Logging parses them natively)
    logger: new ConsoleLogger({ json: true, prefix: 'entries' }),
  });
  app.enableShutdownHooks(); // Cloud Run SIGTERM drains connections and the relay
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '16kb' });
  await app.listen(config().port);
}
bootstrap();

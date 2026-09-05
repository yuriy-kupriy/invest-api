import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { AccountsModule } from '@/accounts/accounts.module';
import { validateEnv } from '@/config/env.validation';
import { DbModule } from '@/db/db.module';
import { HealthModule } from '@/health/health.module';
import { IdempotencyMiddleware } from '@/shared/idempotency.middleware';
import { ProblemExceptionFilter } from '@/shared/problem.filter';
import { TransactionsModule } from '@/transactions/transactions.module';

@Module({
  imports: [
    // First import on purpose: `validate` runs before the DI graph exists, so a
    // broken variable kills the process here — not on the first request in prod.
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env'],
      validate: validateEnv,
    }),
    DbModule,
    HealthModule,
    AccountsModule,
    TransactionsModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: ProblemExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(IdempotencyMiddleware).forRoutes('*');
  }
}

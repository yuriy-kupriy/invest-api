import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AccountsModule } from '@/accounts/accounts.module';
import { AuthModule } from '@/auth/auth.module';
import { validateEnv } from '@/config/env.validation';
import { CurrenciesModule } from '@/currencies/currencies.module';
import { DbModule } from '@/db/db.module';
import { FxRatesModule } from '@/fx-rates/fx-rates.module';
import { HealthModule } from '@/health/health.module';
import { OrdersModule } from '@/orders/orders.module';
import { IdempotencyInterceptor } from '@/shared/idempotency.interceptor';
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
    AuthModule,
    HealthModule,
    AccountsModule,
    CurrenciesModule,
    FxRatesModule,
    TransactionsModule,
    OrdersModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: ProblemExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: IdempotencyInterceptor,
    },
  ],
})
export class AppModule {}

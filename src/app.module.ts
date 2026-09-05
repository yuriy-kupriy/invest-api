import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AccountsModule } from '@/accounts/accounts.module';
import { IdempotencyMiddleware } from '@/shared/idempotency.middleware';
import { ProblemExceptionFilter } from '@/shared/problem.filter';
import { TransactionsModule } from '@/transactions/transactions.module';

@Module({
  imports: [AccountsModule, TransactionsModule],
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

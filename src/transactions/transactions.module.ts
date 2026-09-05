import { Module } from '@nestjs/common';
import { AccountsModule } from '@/accounts/accounts.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsRepository, InMemoryTransactionsRepository } from './transactions.repository';
import { TransactionsService } from './transactions.service';

@Module({
  imports: [AccountsModule],
  controllers: [TransactionsController],
  providers: [
    TransactionsService,
    {
      provide: TransactionsRepository,
      useClass: InMemoryTransactionsRepository,
    },
  ],
})
export class TransactionsModule {}

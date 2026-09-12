import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from '@/accounts/accounts.module';
import { AppTypeOrmModule } from '@/db/typeorm.module';
import { Instrument } from '@/entities/instrument.entity';
import { Transaction as TransactionEntity } from '@/entities/transaction.entity';
import { TransactionsController } from './transactions.controller';
import { TransactionsRepository, InMemoryTransactionsRepository } from './transactions.repository';
import { TransactionsService } from './transactions.service';
import { TypeOrmTransactionsRepository } from './typeorm-transactions.repository';

// Opt-in TypeORM backend (see src/db/typeorm.module.ts) — default stays
// in-memory so `npm start`/`npm test` don't require a live Postgres.
const useTypeOrm = process.env.DB_BACKEND === 'typeorm';

@Module({
  imports: [
    AccountsModule,
    ...(useTypeOrm ? [AppTypeOrmModule, TypeOrmModule.forFeature([TransactionEntity, Instrument])] : []),
  ],
  controllers: [TransactionsController],
  providers: [
    TransactionsService,
    {
      provide: TransactionsRepository,
      useClass: useTypeOrm ? TypeOrmTransactionsRepository : InMemoryTransactionsRepository,
    },
  ],
})
export class TransactionsModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from '@/accounts/accounts.module';
import { AppTypeOrmModule } from '@/db/typeorm.module';
import { Instrument } from '@/entities/instrument.entity';
import { Transaction as TransactionEntity } from '@/entities/transaction.entity';
import { TransactionsController } from './transactions.controller';
import { TransactionsRepository } from './transactions.repository';
import { TransactionsService } from './transactions.service';

@Module({
  imports: [AccountsModule, AppTypeOrmModule, TypeOrmModule.forFeature([TransactionEntity, Instrument])],
  controllers: [TransactionsController],
  providers: [TransactionsService, TransactionsRepository],
})
export class TransactionsModule {}

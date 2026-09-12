import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppTypeOrmModule } from '@/db/typeorm.module';
import { Account as AccountEntity } from '@/entities/account.entity';
import { AccountsController } from './accounts.controller';
import { AccountsRepository, InMemoryAccountsRepository } from './accounts.repository';
import { AccountsService } from './accounts.service';
import { TypeOrmAccountsRepository } from './typeorm-accounts.repository';

// Opt-in TypeORM backend (see src/db/typeorm.module.ts) — default stays
// in-memory so `npm start`/`npm test` don't require a live Postgres.
const useTypeOrm = process.env.DB_BACKEND === 'typeorm';

@Module({
  imports: useTypeOrm ? [AppTypeOrmModule, TypeOrmModule.forFeature([AccountEntity])] : [],
  controllers: [AccountsController],
  providers: [
    AccountsService,
    {
      provide: AccountsRepository,
      useClass: useTypeOrm ? TypeOrmAccountsRepository : InMemoryAccountsRepository,
    },
  ],
  exports: [AccountsRepository],
})
export class AccountsModule {}

import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { AccountsRepository, InMemoryAccountsRepository } from './accounts.repository';
import { AccountsService } from './accounts.service';

@Module({
  controllers: [AccountsController],
  providers: [
    AccountsService,
    {
      provide: AccountsRepository,
      useClass: InMemoryAccountsRepository,
    },
  ],
  exports: [AccountsRepository],
})
export class AccountsModule {}

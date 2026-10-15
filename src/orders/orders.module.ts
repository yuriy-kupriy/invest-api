import { Module } from '@nestjs/common';
import { AccountsModule } from '@/accounts/accounts.module';
import { AuthModule } from '@/auth/auth.module';
import { TransactionsModule } from '@/transactions/transactions.module';
import { OrderEventsService } from './order-events.service';
import { OrdersController } from './orders.controller';
import { OrdersGateway } from './orders.gateway';
import { OrdersService } from './orders.service';

@Module({
  imports: [AccountsModule, AuthModule, TransactionsModule],
  controllers: [OrdersController],
  providers: [OrderEventsService, OrdersService, OrdersGateway],
})
export class OrdersModule {}

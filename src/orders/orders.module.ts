import { Module } from '@nestjs/common';
import { AccountsModule } from '@/accounts/accounts.module';
import { AuthModule } from '@/auth/auth.module';
import { TransactionsModule } from '@/transactions/transactions.module';
import { OrderEventsService } from './order-events.service';
import { CheckoutController, OrdersController, TradeWebhookController } from './orders.controller';
import { OrdersGateway } from './orders.gateway';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';
import { TradeSettlementService } from './trade-settlement.service';

@Module({
  imports: [AccountsModule, AuthModule, TransactionsModule],
  controllers: [OrdersController, CheckoutController, TradeWebhookController],
  providers: [OrderEventsService, OrdersService, OrdersRepository, OrdersGateway, TradeSettlementService],
})
export class OrdersModule {}

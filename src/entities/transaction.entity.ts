import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Account } from './account.entity';
import { Category } from './category.entity';
import { Currency } from './currency.entity';
import { Instrument } from './instrument.entity';
import { bigintTransformer } from './transformers';

export type TransactionType = 'income' | 'expense' | 'transfer_in' | 'transfer_out' | 'buy' | 'sell';
export type TransactionStatus = 'pending' | 'posted' | 'failed';

/**
 * The main table (500k rows after seeding in HW #12). This is also the
 * project's explicit many-to-many-with-data join: it links accounts↔instruments
 * and carries quantity/price/fx-rate on the link, so it is modeled as its own
 * entity with @ManyToOne on both sides rather than a bare @ManyToMany.
 */
@Entity({ name: 'transactions' })
@Check(
  'transactions_instrument_matches_type',
  "(type IN ('buy', 'sell')) = (instrument_id IS NOT NULL)",
)
@Check('transactions_base_currency_rate_is_one', "(currency = 'UAH') = (fx_rate = 1)")
@Check('transactions_type_enum', "type IN ('income', 'expense', 'transfer_in', 'transfer_out', 'buy', 'sell')")
@Check('transactions_status_enum', "status IN ('pending', 'posted', 'failed')")
@Check('transactions_amount_non_negative', 'amount_cents >= 0')
@Check('transactions_fx_rate_positive', 'fx_rate > 0')
@Check('transactions_quantity_positive', 'quantity_micro > 0')
@Check('transactions_unit_price_positive', 'unit_price > 0')
@Check('transactions_description_length', 'length(description) <= 500')
// Composite index for q1 (account statement, newest first) and a partial index
// for q2 (pending queue, newest first) — both need DESC ordering that the
// decorator can't express, so the real DDL lives in the migration by hand.
@Index('transactions_account_booked_idx', { synchronize: false })
@Index('transactions_pending_booked_idx', { synchronize: false })
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  // A transaction has no meaning detached from its account: when the account
  // goes, its ledger goes with it.
  @ManyToOne(() => Account, (account) => account.transactions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account!: Account;

  @Column({ name: 'instrument_id', type: 'uuid', nullable: true })
  instrumentId!: string | null;

  // An instrument that has been bought or sold can't be deleted out from under
  // its trade history — RESTRICT protects that history instead of cascading
  // over it.
  @ManyToOne(() => Instrument, (instrument) => instrument.transactions, {
    onDelete: 'RESTRICT',
    nullable: true,
  })
  @JoinColumn({ name: 'instrument_id' })
  instrument!: Instrument | null;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId!: string | null;

  // A category is just a classification; losing it should reclassify the
  // transaction as uncategorized, not erase the transaction itself.
  @ManyToOne(() => Category, (category) => category.transactions, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'category_id' })
  category!: Category | null;

  @Column({ type: 'text' })
  currency!: string;

  @ManyToOne(() => Currency, (currency) => currency.transactions)
  @JoinColumn({ name: 'currency' })
  currencyRef!: Currency;

  @Column({ type: 'text' })
  type!: TransactionType;

  @Column({ type: 'text', default: 'posted' })
  status!: TransactionStatus;

  @Column({ name: 'amount_cents', type: 'bigint', transformer: bigintTransformer })
  amountCents!: number;

  @Column({ name: 'fx_rate', type: 'numeric', precision: 20, scale: 10, default: 1 })
  fxRate!: string;

  @Column({ name: 'quantity_micro', type: 'bigint', nullable: true, transformer: bigintTransformer })
  quantityMicro!: number | null;

  @Column({ name: 'unit_price', type: 'numeric', precision: 20, scale: 10, nullable: true })
  unitPrice!: string | null;

  @Column({ name: 'booked_at', type: 'timestamptz' })
  bookedAt!: Date;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

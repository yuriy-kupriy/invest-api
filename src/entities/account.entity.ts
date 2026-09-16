import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Currency } from './currency.entity';
import { Transaction } from './transaction.entity';
import { bigintTransformer } from './transformers';
import { User } from './user.entity';

export type AccountType = 'cash' | 'bank' | 'brokerage' | 'property';

@Entity({ name: 'accounts' })
@Check('accounts_name_length', 'length(name) BETWEEN 1 AND 120')
@Check('accounts_type_enum', "type IN ('cash', 'bank', 'brokerage', 'property')")
// Redundant on its own (`id` is already the PK) — it exists so `transactions`
// can carry a composite FK (account_id, currency) → (id, currency) and have the
// database, not just the service layer, reject a USD transaction on a UAH
// account. Declared here so a future migration:generate doesn't drop it.
@Unique('accounts_id_currency_uk', ['id', 'currency'])
// Expression index for q3 (case-insensitive lookup by name); the decorator
// below records this index in entity metadata for migration:generate. The
// DESC/lower() expression itself is written by hand in the migration.
@Index('accounts_lower_name_idx', { synchronize: false })
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  // Accounts don't survive their owner: the whole point of "ON DELETE CASCADE"
  // here is that a deleted user takes their accounts (and by extension their
  // transactions) with them — there is no orphaned-account state in this domain.
  @ManyToOne(() => User, (user) => user.accounts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'text' })
  currency!: string;

  @ManyToOne(() => Currency, (currency) => currency.accounts)
  @JoinColumn({ name: 'currency' })
  currencyRef!: Currency;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  type!: AccountType;

  @Column({ name: 'balance_cents', type: 'bigint', default: 0, transformer: bigintTransformer })
  balanceCents!: number;

  @Column({ name: 'is_archived', type: 'boolean', default: false })
  isArchived!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => Transaction, (transaction) => transaction.account)
  transactions?: Transaction[];
}

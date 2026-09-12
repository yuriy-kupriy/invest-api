import { Check, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Currency } from './currency.entity';
import { Transaction } from './transaction.entity';

export type AssetClass = 'equity' | 'etf' | 'bond' | 'crypto';

@Entity({ name: 'instruments' })
@Check('instruments_symbol_format', "symbol ~ '^[A-Z0-9.\\-]{1,20}$'")
@Check('instruments_name_length', 'length(name) BETWEEN 1 AND 120')
@Check('instruments_asset_class_enum', "asset_class IN ('equity', 'etf', 'bond', 'crypto')")
export class Instrument {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', unique: true })
  symbol!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'asset_class', type: 'text' })
  assetClass!: AssetClass;

  @Column({ type: 'text' })
  currency!: string;

  @ManyToOne(() => Currency, (currency) => currency.instruments)
  @JoinColumn({ name: 'currency' })
  currencyRef!: Currency;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => Transaction, (transaction) => transaction.instrument)
  transactions?: Transaction[];
}

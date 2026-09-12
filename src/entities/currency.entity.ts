import { Check, Column, Entity, OneToMany, PrimaryColumn } from 'typeorm';
import { Account } from './account.entity';
import { FxRate } from './fx-rate.entity';
import { Instrument } from './instrument.entity';
import { Transaction } from './transaction.entity';

/**
 * ISO 4217 lookup — see db/schema.sql for the rationale (a new currency is one
 * INSERT instead of a migration rewriting a CHECK across 500k rows).
 */
@Entity({ name: 'currency' })
@Check('currency_code_format', "code ~ '^[A-Z]{3}$'")
@Check('currency_numeric_code_range', 'numeric_code BETWEEN 1 AND 999')
@Check('currency_exponent_range', 'exponent BETWEEN 0 AND 6')
@Check('currency_name_length', 'length(name) BETWEEN 1 AND 80')
export class Currency {
  @PrimaryColumn({ type: 'text' })
  code!: string;

  @Column({ name: 'numeric_code', type: 'smallint', unique: true })
  numericCode!: number;

  @Column({ type: 'smallint' })
  exponent!: number;

  @Column({ type: 'text' })
  name!: string;

  @OneToMany(() => Account, (account) => account.currency)
  accounts?: Account[];

  @OneToMany(() => Instrument, (instrument) => instrument.currency)
  instruments?: Instrument[];

  @OneToMany(() => Transaction, (transaction) => transaction.currency)
  transactions?: Transaction[];

  @OneToMany(() => FxRate, (fxRate) => fxRate.currencyRef)
  fxRates?: FxRate[];
}

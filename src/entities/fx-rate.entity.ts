import { Check, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Currency } from './currency.entity';

/**
 * A currency's rate on a given date, from a given source. Composite PK
 * (source, currency, rate_date) doubles as the only index this table's one
 * access pattern needs — see db/schema.sql for the full rationale.
 */
@Entity({ name: 'fx_rate' })
@Check('fx_rate_source_length', 'length(source) BETWEEN 1 AND 40')
@Check('fx_rate_raw_rate_positive', 'raw_rate > 0')
@Check('fx_rate_raw_units_positive', 'raw_units > 0')
@Check('fx_rate_base_is_not_quoted', "currency <> 'UAH'")
export class FxRate {
  @PrimaryColumn({ type: 'text' })
  source!: string;

  @PrimaryColumn({ type: 'text' })
  currency!: string;

  @ManyToOne(() => Currency, (currency) => currency.fxRates)
  @JoinColumn({ name: 'currency' })
  currencyRef!: Currency;

  @PrimaryColumn({ name: 'rate_date', type: 'date' })
  rateDate!: string;

  @Column({ name: 'raw_rate', type: 'numeric', precision: 20, scale: 10 })
  rawRate!: string;

  @Column({ name: 'raw_units', type: 'integer', default: 1 })
  rawUnits!: number;

  // Generated column: never written to directly, Postgres computes it. The
  // migration carries the real `GENERATED ALWAYS AS (...) STORED` expression —
  // this decorator only tells TypeORM not to try to INSERT/UPDATE it.
  @Column({
    type: 'numeric',
    precision: 20,
    scale: 10,
    generatedType: 'STORED',
    asExpression: '(raw_rate / raw_units)::numeric(20,10)',
    insert: false,
    update: false,
  })
  rate!: string;

  @CreateDateColumn({ name: 'fetched_at', type: 'timestamptz' })
  fetchedAt!: Date;
}

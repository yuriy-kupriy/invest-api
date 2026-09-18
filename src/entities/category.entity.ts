import { Check, Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Transaction } from './transaction.entity';

export type CategoryKind = 'income' | 'expense';

@Entity({ name: 'categories' })
@Check('categories_name_length', 'length(name) BETWEEN 1 AND 60')
@Check('categories_kind_enum', "kind IN ('income', 'expense')")
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', unique: true })
  name!: string;

  @Column({ type: 'text' })
  kind!: CategoryKind;

  @OneToMany(() => Transaction, (transaction) => transaction.category)
  transactions?: Transaction[];
}

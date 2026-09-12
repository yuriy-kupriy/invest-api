import { Check, Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Account } from './account.entity';

@Entity({ name: 'users' })
@Check('users_email_length', 'length(email) BETWEEN 3 AND 254')
@Check('users_display_name_length', 'length(display_name) BETWEEN 1 AND 120')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', unique: true })
  email!: string;

  @Column({ name: 'display_name', type: 'text' })
  displayName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => Account, (account) => account.user)
  accounts?: Account[];
}

import { Check, Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import type { Role } from '../auth/auth.types';
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

  /** scrypt hash (see src/auth/password.ts); NULL means this user cannot log in. */
  @Column({ name: 'password_hash', type: 'text', nullable: true })
  passwordHash!: string | null;

  /** Source of truth for authorization; the token's `role` claim only caches it. */
  @Column({ type: 'text', default: 'member' })
  role!: Role;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @OneToMany(() => Account, (account) => account.user)
  accounts?: Account[];
}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOptions } from '@/data-source';

/**
 * Opt-in: only imported when DB_BACKEND=typeorm (see accounts.module.ts /
 * transactions.module.ts). Default runtime stays on the in-memory
 * repositories so `npm start` and `npm test` need no live Postgres — this
 * module exists to prove the entities wire into Nest, not to replace the
 * HW #9 contract's default backend.
 */
@Module({
  imports: [TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: false })],
  exports: [TypeOrmModule],
})
export class AppTypeOrmModule {}

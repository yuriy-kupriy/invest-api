import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOptions } from '@/data-source';

/**
 * The app's only database backend: accounts.module.ts and
 * transactions.module.ts both import this to get a `Repository<T>` per
 * entity via `TypeOrmModule.forFeature`. `npm start` and `npm run
 * test:e2e` need a live, migrated Postgres as a result — `npm test` (unit
 * specs) never imports these Nest modules, so it stays DB-free.
 */
@Module({
  imports: [TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: false })],
  exports: [TypeOrmModule],
})
export class AppTypeOrmModule {}

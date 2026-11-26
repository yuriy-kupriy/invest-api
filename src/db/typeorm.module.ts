import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOptions } from '@/data-source';

/**
 * The app's only database backend and its only pg.Pool. Imported once, by
 * AppModule (the DataSource it registers is global); feature modules only add
 * `TypeOrmModule.forFeature`. `npm test` (unit specs) never imports it, so it
 * stays DB-free.
 */
@Module({
  imports: [TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: false })],
  exports: [TypeOrmModule],
})
export class AppTypeOrmModule {}

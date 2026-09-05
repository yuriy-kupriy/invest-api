import { ApiProperty } from '@nestjs/swagger';
import { Env, NODE_ENVS } from '@/config/env.schema';
import { i18n } from '@/i18n/swagger';

export class HealthDto {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  status!: 'ok';

  @ApiProperty({ example: 42.317, description: i18n('dto.health.uptime') })
  uptime_seconds!: number;

  @ApiProperty({ example: '1.0.0' })
  version!: string;

  @ApiProperty({ enum: NODE_ENVS, example: 'development' })
  node_env!: Env['NODE_ENV'];
}

export class DbHealthDto {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  status!: 'ok';

  @ApiProperty({ example: 3.114, description: i18n('dto.health.latency') })
  latency_ms!: number;

  @ApiProperty({ format: 'date-time', example: '2026-09-05T10:00:00.000Z' })
  now!: string;

  @ApiProperty({ example: 1, description: i18n('dto.health.probeRows') })
  probe_rows!: number;

  @ApiProperty({ example: 1, description: i18n('dto.health.poolTotal') })
  pool_total!: number;

  @ApiProperty({ example: 1 })
  pool_idle!: number;
}

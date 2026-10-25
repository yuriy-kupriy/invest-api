import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Env } from '@/config/env.schema';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard, RolesGuard } from './guards';
import { JwtStrategy } from './jwt.strategy';
import { LocalStrategy } from './local.strategy';
import { ACCESS_TTL_SECONDS, JWT_AUDIENCE, JWT_ISSUER, TokensService } from './tokens.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        // privateKey, not `secret`: asymmetric signing. JwtModule only signs —
        // verification is JwtStrategy's, with its own algorithms allowlist.
        privateKey: config.get('JWT_PRIVATE_KEY', { infer: true }),
        signOptions: {
          algorithm: 'ES256',
          keyid: config.get('JWT_KID', { infer: true }),
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
          expiresIn: ACCESS_TTL_SECONDS,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokensService,
    LocalStrategy,
    JwtStrategy,
    // Order matters: authenticate (401) first, then authorize by role (403).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}

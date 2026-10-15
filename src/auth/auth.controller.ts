import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { AuthService, LoginUser } from './auth.service';
import { AuthUser, TokenPair } from './auth.types';
import { CurrentUser, Public } from './decorators';
import { LocalAuthGuard } from './guards';

class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refresh_token!: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Body { email, password } is read by LocalStrategy, before this handler runs. */
  @Public()
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@CurrentUser() user: LoginUser): Promise<TokenPair> {
    return this.auth.login(user);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() body: RefreshDto): Promise<TokenPair> {
    return this.auth.refresh(body.refresh_token);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@CurrentUser() user: AuthUser): Promise<void> {
    return this.auth.logout(user);
  }
}

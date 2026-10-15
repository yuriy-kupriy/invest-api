import { HttpStatus, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { problem } from '@/shared/problem.exception';
import { AuthService, LoginUser } from './auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly auth: AuthService) {
    super({ usernameField: 'email' });
  }

  async validate(email: string, password: string): Promise<LoginUser> {
    const user = await this.auth.validateUser(email, password);
    if (!user) {
      throw problem(HttpStatus.UNAUTHORIZED, 'invalid-credentials', 'wrong email or password');
    }
    return user;
  }
}

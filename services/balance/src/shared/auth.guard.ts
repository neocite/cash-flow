import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { CONFIG, Config } from './config';

export const SCOPE_KEY = 'scope';
/** Declares the OAuth2 scope required by an endpoint (e.g. balance:read). */
export const RequireScope = (scope: string) => SetMetadata(SCOPE_KEY, scope);

export interface Principal {
  merchantId: string;
  scopes: string[];
}

/**
 * Validates the JWT (signature, issuer, audience, expiry) and the required scope.
 * The merchant is ALWAYS derived from the token (`sub` claim) and never from the
 * payload, so a client cannot read another merchant's balance (IDOR).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(header.slice(7), this.cfg.auth.secret, {
        algorithms: ['HS256'],
        issuer: this.cfg.auth.issuer,
        audience: this.cfg.auth.audience,
      }) as jwt.JwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    if (!payload.sub) throw new UnauthorizedException('Token without subject');

    const scopes = String(payload.scope ?? '').split(' ').filter(Boolean);
    const required = this.reflector.get<string>(SCOPE_KEY, ctx.getHandler());
    if (required && !scopes.includes(required)) {
      throw new ForbiddenException(`Scope ${required} required`);
    }
    req.principal = { merchantId: payload.sub, scopes } satisfies Principal;
    return true;
  }
}

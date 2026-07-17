import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InMemoryShoppingStore } from '../repositories';
import { ViewerMode } from '../shopping.types';
import { InternalTokenGuard } from './internal-token.guard';
import { ViewerTokenService } from './viewer-token.service';

describe('shopping internal security fail-closed behavior', () => {
  it('rejects internal calls when INTERNAL_TOKEN is absent', () => {
    const guard = new InternalTokenGuard(new ConfigService({ shopping: {} }));
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ header: () => 'supplied-token' }),
      }),
    } as unknown as ExecutionContext;
    expect(() => guard.canActivate(context)).toThrow(
      'Invalid internal credentials',
    );
  });

  it('refuses viewer token issuance when VIEWER_TOKEN_SECRET is absent', async () => {
    const service = new ViewerTokenService(
      new JwtService(),
      new ConfigService({
        shopping: { publicOrigin: 'https://dealpilot.test' },
      }),
      new InMemoryShoppingStore(),
    );
    await expect(
      service.issue('run-1', 'user-1', ViewerMode.View),
    ).rejects.toThrow('not configured');
  });
});

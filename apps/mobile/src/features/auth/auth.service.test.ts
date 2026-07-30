import { apiClient } from '@/api/client';
import { login, register } from './auth.service';

jest.mock('@/api/client', () => ({
  apiClient: { post: jest.fn() },
}));

const post = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const session = {
  session: {
    id: 'session-1',
    principalId: 'user-1',
    status: 'active' as const,
    rotationFamilyId: 'family-1',
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-08T00:00:00.000Z',
    revokedAt: null,
  },
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  user: { id: 'user-1', email: 'demo@example.test' },
};
const registration = {
  user: {
    id: 'user-1',
    email: 'demo@example.test',
    displayName: 'Demo User',
    emailVerified: false,
  },
  verificationRequired: true as const,
};

describe('auth service canonical base URL composition', () => {
  beforeEach(() => post.mockReset());

  it('does not duplicate /api/v1 when calling login', async () => {
    post.mockResolvedValue({ data: session });
    await expect(
      login({ email: 'demo@example.test', password: 'password1' }),
    ).resolves.toEqual(session);
    expect(post).toHaveBeenCalledWith('/auth/login', {
      email: 'demo@example.test',
      password: 'password1',
    });
  });

  it('uses the API-relative registration path', async () => {
    post.mockResolvedValue({ data: registration });
    await expect(
      register({
        displayName: 'Demo User',
        email: 'demo@example.test',
        password: 'password1',
      }),
    ).resolves.toEqual(registration);
    expect(post).toHaveBeenCalledWith('/auth/register', {
      displayName: 'Demo User',
      email: 'demo@example.test',
      password: 'password1',
    });
  });
});

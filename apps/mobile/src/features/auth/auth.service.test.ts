import { apiClient } from '@/api/client';
import { login, register } from './auth.service';

jest.mock('@/api/client', () => ({
  apiClient: { post: jest.fn() },
}));

const post = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const session = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  user: { id: 'user-1', email: 'demo@example.test' },
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
    post.mockResolvedValue({ data: session });
    await register({
      displayName: 'Demo User',
      email: 'demo@example.test',
      password: 'password1',
    });
    expect(post).toHaveBeenCalledWith('/auth/register', {
      displayName: 'Demo User',
      email: 'demo@example.test',
      password: 'password1',
    });
  });
});

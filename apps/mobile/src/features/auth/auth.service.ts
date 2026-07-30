import { isAxiosError } from 'axios';
import { apiClient } from '@/api/client';
import { AuthSession, RegistrationResult } from '@/types/auth';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest extends LoginRequest {
  displayName: string;
}

export class AuthenticationError extends Error {
  constructor(public readonly reason: 'invalid' | 'unavailable') {
    super(`AUTH_${reason.toUpperCase()}`);
  }
}

async function submitAuthentication(
  path: 'login',
  request: LoginRequest,
): Promise<AuthSession> {
  try {
    const { data } = await apiClient.post<AuthSession>(
      `/auth/${path}`,
      request,
    );
    return data;
  } catch (error) {
    if (
      isAxiosError(error) &&
      [400, 401, 403, 409].includes(error.response?.status ?? 0)
    ) {
      throw new AuthenticationError('invalid');
    }
    throw new AuthenticationError('unavailable');
  }
}

export function login(request: LoginRequest): Promise<AuthSession> {
  return submitAuthentication('login', request);
}

export async function register(
  request: RegisterRequest,
): Promise<RegistrationResult> {
  try {
    const { data } = await apiClient.post<RegistrationResult>(
      '/auth/register',
      request,
    );
    return data;
  } catch (error) {
    if (
      isAxiosError(error) &&
      [400, 401, 403, 409].includes(error.response?.status ?? 0)
    )
      throw new AuthenticationError('invalid');
    throw new AuthenticationError('unavailable');
  }
}

export interface AuthUser {
  id: string;
  email?: string;
  displayName?: string;
  emailVerified?: boolean;
}

export interface AuthenticationSessionResource {
  id: string;
  principalId: string;
  status: 'active' | 'revoked' | 'expired';
  rotationFamilyId: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface AuthSession {
  session: AuthenticationSessionResource;
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface RegistrationResult {
  user: AuthUser;
  verificationRequired: true;
}

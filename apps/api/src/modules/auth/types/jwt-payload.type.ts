export interface JwtPayload {
  sub: string;
  email?: string;
  roles?: string[];
  permissions?: string[];
  tokenType: 'access' | 'refresh';
}

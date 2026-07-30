export interface JwtPayload {
  sub: string;
  sid: string;
  email?: string;
  roles?: string[];
  permissions?: string[];
  tokenType: 'access';
}

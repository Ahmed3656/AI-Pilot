export interface AuthenticatedActor {
  id: string;
  sessionId?: string;
  email?: string;
  roles: string[];
  permissions: string[];
}

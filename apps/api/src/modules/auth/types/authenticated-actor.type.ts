export interface AuthenticatedActor {
  id: string;
  email?: string;
  roles: string[];
  permissions: string[];
}

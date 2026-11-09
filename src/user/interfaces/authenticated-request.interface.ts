import { AuthenticatedUser } from './authenticated-user.interface';

export interface AuthenticatedRequest {
  user: AuthenticatedUser;
  ip?: string;
  headers: Record<string, string | undefined>;
}

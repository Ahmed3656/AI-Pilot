import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { STORAGE_KEYS } from '@/constants/storage';
import { storage } from '@/storage/storage';
import { AuthSession, AuthUser } from '@/types/auth';

interface AuthContextValue {
  user: AuthUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isRestoring: boolean;
  setSession: (session: AuthSession) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);

  useEffect(() => {
    // TODO(auth): restore user identity from a validated session endpoint.
    storage
      .get(STORAGE_KEYS.accessToken)
      .then(setAccessToken)
      .finally(() => setIsRestoring(false));
  }, []);

  const setSession = useCallback(async (session: AuthSession) => {
    await Promise.all([
      storage.set(STORAGE_KEYS.accessToken, session.accessToken),
      storage.set(STORAGE_KEYS.refreshToken, session.refreshToken),
    ]);
    setAccessToken(session.accessToken);
    setUser(session.user);
  }, []);

  const signOut = useCallback(async () => {
    await Promise.all([
      storage.remove(STORAGE_KEYS.accessToken),
      storage.remove(STORAGE_KEYS.refreshToken),
    ]);
    setAccessToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      accessToken,
      isAuthenticated: Boolean(accessToken),
      isRestoring,
      setSession,
      signOut,
    }),
    [accessToken, isRestoring, setSession, signOut, user],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

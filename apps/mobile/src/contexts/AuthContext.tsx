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
import { subscribeToAuthenticationSession } from '@/api/client';

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

  useEffect(
    () =>
      subscribeToAuthenticationSession((session) => {
        setAccessToken(session?.accessToken ?? null);
        setUser(session?.user ?? null);
      }),
    [],
  );

  useEffect(() => {
    Promise.all([
      storage.get(STORAGE_KEYS.accessToken),
      storage.get(STORAGE_KEYS.authUser),
    ])
      .then(([token, serializedUser]) => {
        setAccessToken(token);
        if (serializedUser) setUser(JSON.parse(serializedUser) as AuthUser);
      })
      .catch(() => {
        setAccessToken(null);
        setUser(null);
      })
      .finally(() => setIsRestoring(false));
  }, []);

  const setSession = useCallback(async (session: AuthSession) => {
    await Promise.all([
      storage.set(STORAGE_KEYS.accessToken, session.accessToken),
      storage.set(STORAGE_KEYS.refreshToken, session.refreshToken),
      storage.set(STORAGE_KEYS.authUser, JSON.stringify(session.user)),
    ]);
    setAccessToken(session.accessToken);
    setUser(session.user);
  }, []);

  const signOut = useCallback(async () => {
    await Promise.all([
      storage.remove(STORAGE_KEYS.accessToken),
      storage.remove(STORAGE_KEYS.refreshToken),
      storage.remove(STORAGE_KEYS.authUser),
    ]);
    setAccessToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      accessToken,
      isAuthenticated: Boolean(accessToken && user),
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

import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';
import { darkTheme, lightTheme, ThemeMode } from '@/theme/theme';
import { STORAGE_KEYS } from '@/constants/storage';
import { storage } from '@/storage/storage';

interface ThemeContextValue {
  mode: ThemeMode;
  isDark: boolean;
  theme: typeof lightTheme;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemMode = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  useEffect(() => {
    storage
      .get(STORAGE_KEYS.themeMode)
      .then((savedMode) => {
        if (
          savedMode === 'light' ||
          savedMode === 'dark' ||
          savedMode === 'system'
        ) {
          setModeState(savedMode);
        }
      })
      .catch(() => undefined);
  }, []);
  const setMode = useCallback((nextMode: ThemeMode) => {
    setModeState(nextMode);
    void storage.set(STORAGE_KEYS.themeMode, nextMode).catch(() => undefined);
  }, []);
  const isDark = mode === 'system' ? systemMode === 'dark' : mode === 'dark';
  const value = useMemo(
    () => ({ mode, setMode, isDark, theme: isDark ? darkTheme : lightTheme }),
    [isDark, mode, setMode],
  );
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}

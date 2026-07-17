import { PropsWithChildren } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ToastProvider } from '@/components/Toast';
import { LocalizationProvider } from '@/localization';
import { QueryProvider } from './QueryProvider';

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <ThemeProvider>
          <LocalizationProvider>
            <ToastProvider>
              <QueryProvider>
                <AuthProvider>{children}</AuthProvider>
              </QueryProvider>
            </ToastProvider>
          </LocalizationProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

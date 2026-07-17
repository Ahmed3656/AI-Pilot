import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavigationThemeProvider,
} from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppProviders } from '@/providers/AppProviders';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { SplashScreen } from '@/screens/SplashScreen';
import { useLocalization } from '@/localization';
import { AuthScreen } from '@/features/auth/screens/AuthScreen';
import { environment } from '@/config/environment';
import { useState } from 'react';

function RootNavigator() {
  const [previewAccessGranted, setPreviewAccessGranted] = useState(false);
  const { isAuthenticated, isRestoring } = useAuth();
  const { isDark, theme } = useTheme();
  const { t } = useLocalization();
  const baseNavigationTheme = isDark ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...baseNavigationTheme,
    colors: {
      ...baseNavigationTheme.colors,
      background: theme.colors.background,
      card: theme.colors.surface,
      text: theme.colors.text,
      border: theme.colors.border,
      primary: theme.colors.primary,
    },
  };
  return (
    <NavigationThemeProvider value={navigationTheme}>
      {isRestoring ? (
        <SplashScreen />
      ) : !environment.authRequired && !previewAccessGranted ? (
        <AuthScreen onPreviewContinue={() => setPreviewAccessGranted(true)} />
      ) : environment.authRequired && !isAuthenticated ? (
        <AuthScreen />
      ) : (
        <Stack>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen
            name="address"
            options={{ title: t('addressProfile') }}
          />
          <Stack.Screen
            name="run/[id]/index"
            options={{ title: t('runTitle') }}
          />
          <Stack.Screen
            name="run/[id]/report"
            options={{ title: t('reportTitle') }}
          />
          <Stack.Screen name="profile" options={{ title: t('account') }} />
          <Stack.Screen
            name="settings"
            options={{ title: t('settingsTitle') }}
          />
        </Stack>
      )}
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </NavigationThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AppProviders>
      <RootNavigator />
    </AppProviders>
  );
}

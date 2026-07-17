import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useLocalization } from '@/localization';

export function SplashScreen() {
  const { theme } = useTheme();
  const { t } = useLocalization();
  return (
    <View
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <Text style={[styles.title, { color: theme.colors.text }]}>
        {t('appName')}
      </Text>
      <ActivityIndicator color={theme.colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },
  title: { fontSize: 28, fontWeight: '800' },
});

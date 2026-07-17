import { StyleSheet, Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { AppButton, Card, Screen } from '@/components';
import { useTheme } from '@/contexts/ThemeContext';
import { getApiHealth } from '@/services/health.service';

export function HomeScreen() {
  const { theme } = useTheme();
  const health = useQuery({ queryKey: ['api-health'], queryFn: getApiHealth });
  const apiStatus = health.isSuccess
    ? 'Connected'
    : health.isError
      ? 'Unavailable'
      : 'Checking…';

  return (
    <Screen>
      <Text style={[styles.eyebrow, { color: theme.colors.primary }]}>
        FOUNDATION READY
      </Text>
      <Text style={[styles.title, { color: theme.colors.text }]}>
        Your AI Pilot starts here.
      </Text>
      <Text style={[styles.body, { color: theme.colors.muted }]}>
        This clean shell is ready for future capabilities. No automation or
        agent behavior is implemented yet.
      </Text>
      <Card>
        <Text style={[styles.cardTitle, { color: theme.colors.text }]}>
          API status
        </Text>
        <Text
          style={{
            color: health.isSuccess ? theme.colors.success : theme.colors.muted,
          }}
        >
          {apiStatus}
        </Text>
      </Card>
      <AppButton
        label="Open profile placeholder"
        onPress={() => router.push('/profile')}
      />
      <AppButton
        label="Open settings"
        onPress={() => router.push('/settings')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    marginTop: 28,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  title: { fontSize: 34, lineHeight: 40, fontWeight: '800' },
  body: { fontSize: 16, lineHeight: 24 },
  cardTitle: { fontSize: 17, fontWeight: '700' },
});

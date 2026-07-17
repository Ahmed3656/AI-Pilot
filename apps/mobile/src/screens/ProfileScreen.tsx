import { StyleSheet, Text } from 'react-native';
import { Card, Screen } from '@/components';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';

export function ProfileScreen() {
  const { user } = useAuth();
  const { theme } = useTheme();
  return (
    <Screen>
      <Text style={[styles.title, { color: theme.colors.text }]}>Profile</Text>
      <Card>
        <Text style={{ color: theme.colors.text }}>
          {user?.displayName ?? 'Profile placeholder'}
        </Text>
        <Text style={{ color: theme.colors.muted }}>
          TODO(profile): connect identity fields after authentication is
          implemented.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: 20, fontSize: 30, fontWeight: '800' },
});

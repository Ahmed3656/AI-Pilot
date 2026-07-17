import { StyleSheet, Text } from 'react-native';
import { Card, Screen } from '@/components';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useLocalization } from '@/localization';

export function ProfileScreen() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const { t, textDirection } = useLocalization();
  return (
    <Screen>
      <Text style={[styles.title, textDirection, { color: theme.colors.text }]}>
        {t('account')}
      </Text>
      <Card>
        <Text
          style={[styles.name, textDirection, { color: theme.colors.text }]}
        >
          {user?.displayName ?? user?.email}
        </Text>
        {user?.displayName && user.email ? (
          <Text style={[textDirection, { color: theme.colors.muted }]}>
            {user.email}
          </Text>
        ) : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: 20, fontSize: 30, fontWeight: '800' },
  name: { fontSize: 17, fontWeight: '800' },
});

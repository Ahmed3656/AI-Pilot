import { StyleSheet, Text, View } from 'react-native';
import { AppButton, Card, Screen } from '@/components';
import { useTheme } from '@/contexts/ThemeContext';

export function SettingsScreen() {
  const { mode, setMode, theme } = useTheme();
  return (
    <Screen>
      <Text style={[styles.title, { color: theme.colors.text }]}>Settings</Text>
      <Card>
        <Text style={{ color: theme.colors.text }}>Theme: {mode}</Text>
        <View style={styles.actions}>
          <AppButton label="Light" onPress={() => setMode('light')} />
          <AppButton label="Dark" onPress={() => setMode('dark')} />
          <AppButton label="System" onPress={() => setMode('system')} />
        </View>
      </Card>
      <Text style={{ color: theme.colors.muted }}>
        TODO(settings): add persisted preferences when platform settings are
        defined.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: 20, fontSize: 30, fontWeight: '800' },
  actions: { gap: 10 },
});

import { Pressable, StyleSheet, Text } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';

interface AppButtonProps {
  label: string;
  onPress: () => void;
}

export function AppButton({ label, onPress }: AppButtonProps) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: theme.colors.primary, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Text style={[styles.label, { color: theme.colors.primaryText }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingHorizontal: 18,
  },
  label: { fontSize: 16, fontWeight: '700' },
});

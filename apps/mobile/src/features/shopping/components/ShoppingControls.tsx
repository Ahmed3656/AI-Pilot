import { ReactNode } from 'react';
import {
  KeyboardTypeOptions,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useLocalization } from '@/localization';

export function LanguageToggle() {
  const { locale, setLocale, t, rowDirection } = useLocalization();
  const { theme } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      style={[
        styles.languageToggle,
        rowDirection,
        { borderColor: theme.colors.border },
      ]}
    >
      {(['en-EG', 'ar-EG'] as const).map((item) => {
        const selected = locale === item;
        return (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            key={item}
            onPress={() => setLocale(item)}
            style={[
              styles.languageOption,
              selected && { backgroundColor: theme.colors.primary },
            ]}
          >
            <Text
              style={{
                color: selected ? theme.colors.primaryText : theme.colors.text,
                fontWeight: '800',
              }}
            >
              {t(item === 'en-EG' ? 'english' : 'arabic')}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface ChoiceChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
}

export function ChoiceChip({ label, selected, onPress }: ChoiceChipProps) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected
            ? theme.colors.primary
            : theme.colors.surface,
          borderColor: selected ? theme.colors.primary : theme.colors.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <Text
        style={{
          color: selected ? theme.colors.primaryText : theme.colors.text,
          fontWeight: '700',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

interface LabelledInputProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  error?: string;
  autoComplete?: 'name' | 'tel' | 'postal-code' | 'street-address' | 'off';
}

export function LabelledInput({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
  error,
  autoComplete = 'off',
}: LabelledInputProps) {
  const { theme } = useTheme();
  const { textDirection } = useLocalization();
  return (
    <View style={styles.inputGroup}>
      <Text style={[styles.label, textDirection, { color: theme.colors.text }]}>
        {label}
      </Text>
      <TextInput
        autoComplete={autoComplete}
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.muted}
        style={[
          styles.input,
          multiline && styles.multiline,
          textDirection,
          {
            color: theme.colors.text,
            backgroundColor: theme.colors.surface,
            borderColor: error ? theme.colors.danger : theme.colors.border,
          },
        ]}
        value={value}
      />
      {error ? (
        <Text
          style={[styles.error, textDirection, { color: theme.colors.danger }]}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function SectionHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  const { theme } = useTheme();
  const { textDirection, rowDirection } = useLocalization();
  return (
    <View style={[styles.sectionHeading, rowDirection]}>
      <View style={styles.sectionText}>
        <Text
          style={[
            styles.sectionTitle,
            textDirection,
            { color: theme.colors.text },
          ]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[
              styles.sectionSubtitle,
              textDirection,
              { color: theme.colors.muted },
            ]}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

export function StatusMessage({
  message,
  tone = 'error',
}: {
  message: string;
  tone?: 'error' | 'success' | 'warning';
}) {
  const { theme } = useTheme();
  const { textDirection } = useLocalization();
  const color =
    tone === 'success'
      ? theme.colors.success
      : tone === 'warning'
        ? theme.colors.warning
        : theme.colors.danger;
  return (
    <Text
      accessibilityRole="alert"
      style={[styles.status, textDirection, { color }]}
    >
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  languageToggle: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 3,
    alignSelf: 'flex-start',
  },
  languageOption: {
    minWidth: 40,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  chip: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 20,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  inputGroup: { gap: 6 },
  label: { fontSize: 14, fontWeight: '700' },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 16,
  },
  multiline: { minHeight: 112, textAlignVertical: 'top' },
  error: { fontSize: 12 },
  sectionHeading: {
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  sectionText: { flex: 1, gap: 4 },
  sectionTitle: { fontSize: 18, fontWeight: '800' },
  sectionSubtitle: { fontSize: 14, lineHeight: 20 },
  status: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
});

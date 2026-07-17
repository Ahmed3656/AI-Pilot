import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppButton } from '@/components';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useLocalization } from '@/localization';
import { AuthenticationError, login, register } from '../auth.service';

type AuthMode = 'login' | 'register';

export function AuthScreen({
  onPreviewContinue,
}: {
  onPreviewContinue?: () => void;
}) {
  const { setSession } = useAuth();
  const { showToast } = useToast();
  const { theme } = useTheme();
  const { locale, setLocale, t, textDirection, rowDirection, isRTL } =
    useLocalization();
  const [mode, setMode] = useState<AuthMode>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const changeMode = (next: AuthMode) => {
    setMode(next);
  };

  const submit = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      showToast(t('authInvalidEmail'), 'warning');
      return;
    }
    if (password.length < 8) {
      showToast(t('authPasswordTooShort'), 'warning');
      return;
    }
    if (mode === 'register' && !displayName.trim()) {
      showToast(t('authNameRequired'), 'warning');
      return;
    }

    if (onPreviewContinue) {
      onPreviewContinue();
      return;
    }
    setIsSubmitting(true);
    try {
      const session =
        mode === 'login'
          ? await login({ email: normalizedEmail, password })
          : await register({
              displayName: displayName.trim(),
              email: normalizedEmail,
              password,
            });
      await setSession(session);
    } catch (reason) {
      showToast(
        reason instanceof AuthenticationError && reason.reason === 'invalid'
          ? t('authFailed')
          : t('authUnavailable'),
        'error',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={[styles.safe, { backgroundColor: theme.colors.background }]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.safe}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.languageRow, rowDirection]}>
            {(['en', 'ar'] as const).map((item) => (
              <Pressable
                accessibilityRole="button"
                key={item}
                onPress={() => setLocale(item)}
                style={[
                  styles.languageButton,
                  locale === item && {
                    backgroundColor: theme.colors.surface,
                    borderColor: theme.colors.border,
                  },
                ]}
              >
                <Text
                  style={{
                    color:
                      locale === item ? theme.colors.text : theme.colors.muted,
                    fontWeight: '800',
                  }}
                >
                  {t(item === 'en' ? 'english' : 'arabic')}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.intro}>
            <View
              style={[styles.logo, { backgroundColor: theme.colors.primary }]}
            >
              <Text style={styles.logoText}>D</Text>
            </View>
            <Text
              style={[
                styles.title,
                textDirection,
                { color: theme.colors.text },
              ]}
            >
              {t('authWelcome')}
            </Text>
            <Text
              style={[
                styles.subtitle,
                textDirection,
                { color: theme.colors.muted },
              ]}
            >
              {t('authSubtitle')}
            </Text>
          </View>

          <View
            style={[
              styles.form,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.formTitle,
                textDirection,
                { color: theme.colors.text },
              ]}
            >
              {t(mode === 'login' ? 'login' : 'createAccount')}
            </Text>

            {onPreviewContinue ? (
              <Text
                style={[
                  styles.previewHint,
                  textDirection,
                  { color: theme.colors.muted },
                ]}
              >
                {t('authPreviewHint')}
              </Text>
            ) : null}

            {mode === 'register' ? (
              <AuthInput
                autoCapitalize="words"
                label={t('displayName')}
                onChangeText={setDisplayName}
                textAlign={isRTL ? 'right' : 'left'}
                value={displayName}
              />
            ) : null}
            <AuthInput
              autoCapitalize="none"
              keyboardType="email-address"
              label={t('email')}
              onChangeText={setEmail}
              textAlign={isRTL ? 'right' : 'left'}
              value={email}
            />
            <AuthInput
              autoCapitalize="none"
              helper={t('authPasswordHint')}
              label={t('password')}
              onChangeText={setPassword}
              secureTextEntry
              textAlign={isRTL ? 'right' : 'left'}
              value={password}
            />

            <AppButton
              disabled={isSubmitting}
              label={t(
                isSubmitting
                  ? 'authWorking'
                  : mode === 'login'
                    ? 'login'
                    : 'createAccount',
              )}
              onPress={() => void submit()}
            />

            <View style={[styles.switchRow, rowDirection]}>
              <Text style={{ color: theme.colors.muted }}>
                {t(mode === 'login' ? 'needAccount' : 'haveAccount')}
              </Text>
              <Pressable
                onPress={() =>
                  changeMode(mode === 'login' ? 'register' : 'login')
                }
              >
                <Text
                  style={{ color: theme.colors.primary, fontWeight: '800' }}
                >
                  {t(mode === 'login' ? 'createAccount' : 'login')}
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function AuthInput({
  label,
  helper,
  textAlign,
  ...props
}: React.ComponentProps<typeof TextInput> & {
  label: string;
  helper?: string;
  textAlign: 'left' | 'right';
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.inputGroup}>
      <Text style={[styles.label, { color: theme.colors.text, textAlign }]}>
        {label}
      </Text>
      <TextInput
        {...props}
        placeholderTextColor={theme.colors.muted}
        style={[
          styles.input,
          {
            backgroundColor: theme.colors.background,
            borderColor: theme.colors.border,
            color: theme.colors.text,
            textAlign,
          },
        ]}
      />
      {helper ? (
        <Text style={{ color: theme.colors.muted, fontSize: 12, textAlign }}>
          {helper}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
    gap: 28,
  },
  languageRow: {
    position: 'absolute',
    top: 12,
    right: 0,
    gap: 4,
  },
  languageButton: {
    minWidth: 42,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 10,
  },
  intro: { alignItems: 'center', gap: 12 },
  logo: {
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
  },
  logoText: { color: '#FFFFFF', fontSize: 27, fontWeight: '900' },
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    maxWidth: 360,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  form: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 22,
    padding: 20,
    gap: 16,
  },
  formTitle: { fontSize: 21, fontWeight: '800' },
  previewHint: { fontSize: 13, lineHeight: 19 },
  inputGroup: { gap: 7 },
  label: { fontSize: 14, fontWeight: '700' },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  switchRow: { justifyContent: 'center', flexWrap: 'wrap', gap: 6 },
});

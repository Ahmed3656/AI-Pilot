import {
  AccessibilityInfo,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { useLocalization } from '@/localization';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  dismissToast: () => void;
  showToast: (
    message: string,
    tone?: ToastTone,
    durationMs?: number,
  ) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const toneIcon: Record<ToastTone, string> = {
  success: '✓',
  error: '!',
  warning: '!',
  info: 'i',
};

export function ToastProvider({ children }: PropsWithChildren) {
  const { theme } = useTheme();
  const { rowDirection, t, textDirection } = useLocalization();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastItem | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-18)).current;
  const toastId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissToast = useCallback(() => {
    const dismissingId = toastId.current;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: -12,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished && toastId.current === dismissingId) setToast(null);
    });
  }, [opacity, translateY]);

  const showToast = useCallback(
    (message: string, tone: ToastTone = 'info', durationMs = 3800) => {
      toastId.current += 1;
      const nextId = toastId.current;
      if (timer.current) clearTimeout(timer.current);
      opacity.stopAnimation();
      translateY.stopAnimation();
      opacity.setValue(0);
      translateY.setValue(-18);
      setToast({ id: nextId, message, tone });
      requestAnimationFrame(() => {
        Animated.parallel([
          Animated.spring(translateY, {
            toValue: 0,
            damping: 20,
            stiffness: 240,
            mass: 0.75,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 1,
            duration: 160,
            useNativeDriver: true,
          }),
        ]).start();
      });
      void AccessibilityInfo.announceForAccessibility(message);
      timer.current = setTimeout(dismissToast, durationMs);
    },
    [dismissToast, opacity, translateY],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const value = useMemo(
    () => ({ dismissToast, showToast }),
    [dismissToast, showToast],
  );
  const accent = toast
    ? {
        success: theme.colors.success,
        error: theme.colors.danger,
        warning: theme.colors.warning,
        info: theme.colors.primary,
      }[toast.tone]
    : theme.colors.primary;

  return (
    <ToastContext.Provider value={value}>
      <View style={styles.root}>
        {children}
        <View
          pointerEvents="box-none"
          style={[styles.viewport, { top: insets.top + 10 }]}
        >
          {toast ? (
            <Animated.View
              key={toast.id}
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
              style={[
                styles.toast,
                rowDirection,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  opacity,
                  transform: [{ translateY }],
                },
              ]}
            >
              <View style={[styles.icon, { borderColor: accent }]}>
                <Text style={[styles.iconText, { color: accent }]}>
                  {toneIcon[toast.tone]}
                </Text>
              </View>
              <Text
                style={[
                  styles.message,
                  textDirection,
                  { color: theme.colors.text },
                ]}
              >
                {toast.message}
              </Text>
              <Pressable
                accessibilityLabel={t('close')}
                accessibilityRole="button"
                hitSlop={10}
                onPress={dismissToast}
                style={({ pressed }) => [
                  styles.dismiss,
                  { opacity: pressed ? 0.45 : 1 },
                ]}
              >
                <Text style={[styles.dismissText, { color: theme.colors.muted }]}>
                  ×
                </Text>
              </Pressable>
            </Animated.View>
          ) : null}
        </View>
      </View>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  viewport: {
    position: 'absolute',
    left: 14,
    right: 14,
    zIndex: 1000,
    alignItems: 'center',
  },
  toast: {
    width: '100%',
    maxWidth: 560,
    minHeight: 54,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 10,
    gap: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 8,
  },
  icon: {
    width: 24,
    height: 24,
    borderWidth: 1.5,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { fontSize: 13, lineHeight: 16, fontWeight: '900' },
  message: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  dismiss: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: { fontSize: 22, lineHeight: 24, fontWeight: '400' },
});

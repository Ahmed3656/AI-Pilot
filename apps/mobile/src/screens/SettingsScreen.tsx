import { ReactNode, useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Screen } from '@/components';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { LanguageToggle } from '@/features/shopping/components/ShoppingControls';
import {
  EgyptAddressBook,
  emptyEgyptAddressBook,
  loadEgyptAddressBook,
  setDefaultEgyptAddress,
} from '@/features/shopping/address';
import { useLocalization } from '@/localization';
import { ThemeMode } from '@/theme/theme';

const appearanceOptions: ThemeMode[] = ['light', 'dark', 'system'];

export function SettingsScreen() {
  const { user, signOut } = useAuth();
  const { showToast } = useToast();
  const { mode, setMode, theme } = useTheme();
  const { t, textDirection, rowDirection } = useLocalization();
  const addressOwnerId = user?.id ?? 'guest';
  const [addressBook, setAddressBook] = useState<EgyptAddressBook>(
    emptyEgyptAddressBook,
  );
  const [busyAddressId, setBusyAddressId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadEgyptAddressBook(addressOwnerId)
        .then((book) => {
          if (active) setAddressBook(book);
        })
        .catch(() => {
          if (active) setAddressBook(emptyEgyptAddressBook());
        });
      return () => {
        active = false;
      };
    }, [addressOwnerId]),
  );

  const chooseDefaultAddress = async (addressId: string) => {
    setBusyAddressId(addressId);
    try {
      setAddressBook(await setDefaultEgyptAddress(addressOwnerId, addressId));
      showToast(t('defaultAddressChanged'), 'success');
    } catch {
      showToast(t('addressSelectionFailed'), 'error');
    } finally {
      setBusyAddressId(null);
    }
  };

  return (
    <Screen style={styles.screen}>
      <SettingsSection title={t('account')}>
        <View style={[styles.accountContent, rowDirection]}>
          <View
            style={[
              styles.accountAvatar,
              { backgroundColor: theme.colors.primary },
            ]}
          >
            <Text
              style={{ color: theme.colors.primaryText, fontWeight: '900' }}
            >
              {(
                user?.displayName?.[0] ??
                user?.email?.[0] ??
                'D'
              ).toUpperCase()}
            </Text>
          </View>
          <View style={styles.accountText}>
            <Text
              style={[
                styles.primaryText,
                textDirection,
                { color: theme.colors.text },
              ]}
            >
              {user?.displayName ?? user?.email ?? t('guest')}
            </Text>
            <Text
              style={[
                styles.secondaryText,
                textDirection,
                { color: theme.colors.muted },
              ]}
            >
              {t(user ? 'preferencesHint' : 'guestHint')}
            </Text>
          </View>
        </View>
      </SettingsSection>

      <SettingsSection title={t('savedAddresses')}>
        {addressBook.addresses.length === 0 ? (
          <Text
            style={[
              styles.emptyText,
              textDirection,
              { color: theme.colors.muted },
            ]}
          >
            {t('noSavedAddresses')}
          </Text>
        ) : (
          addressBook.addresses.map((record, index) => {
            const selected = record.id === addressBook.defaultAddressId;
            return (
              <View key={record.id}>
                {index > 0 ? (
                  <View
                    style={[
                      styles.separator,
                      { backgroundColor: theme.colors.border },
                    ]}
                  />
                ) : null}
                <View style={[styles.addressRow, rowDirection]}>
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    disabled={busyAddressId !== null}
                    onPress={() => void chooseDefaultAddress(record.id)}
                    style={[styles.addressChoice, rowDirection]}
                  >
                    <View
                      style={[
                        styles.radio,
                        { borderColor: theme.colors.primary },
                        selected && {
                          backgroundColor: theme.colors.primary,
                        },
                      ]}
                    />
                    <View style={styles.addressTextBlock}>
                      <View style={[styles.labelRow, rowDirection]}>
                        <Text
                          style={[
                            styles.primaryText,
                            textDirection,
                            { color: theme.colors.text },
                          ]}
                        >
                          {record.label}
                        </Text>
                        {selected ? (
                          <Text
                            style={[
                              styles.defaultBadge,
                              { color: theme.colors.success },
                            ]}
                          >
                            {t('defaultBadge')}
                          </Text>
                        ) : null}
                      </View>
                      <Text
                        numberOfLines={2}
                        style={[
                          styles.secondaryText,
                          textDirection,
                          { color: theme.colors.muted },
                        ]}
                      >
                        {record.profile.street}, {record.profile.cityOrArea},{' '}
                        {record.profile.governorate}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: '/address',
                        params: { addressId: record.id },
                      })
                    }
                    style={styles.textButton}
                  >
                    <Text
                      style={{ color: theme.colors.primary, fontWeight: '800' }}
                    >
                      {t('edit')}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
        <View
          style={[styles.separator, { backgroundColor: theme.colors.border }]}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.push({ pathname: '/address', params: { addressId: 'new' } })
          }
          style={[styles.addAddress, rowDirection]}
        >
          <Text style={{ color: theme.colors.primary, fontSize: 20 }}>＋</Text>
          <Text style={{ color: theme.colors.text, fontWeight: '700' }}>
            {t('addNewAddress')}
          </Text>
        </Pressable>
      </SettingsSection>

      <SettingsSection title={t('themeLabel')}>
        <View
          style={[
            styles.segmented,
            rowDirection,
            { backgroundColor: theme.colors.background },
          ]}
        >
          {appearanceOptions.map((option) => {
            const selected = mode === option;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={option}
                onPress={() => setMode(option)}
                style={[
                  styles.segment,
                  selected && { backgroundColor: theme.colors.primary },
                ]}
              >
                <Text
                  style={{
                    color: selected
                      ? theme.colors.primaryText
                      : theme.colors.muted,
                    fontWeight: '800',
                  }}
                >
                  {t(option)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View
          style={[styles.separator, { backgroundColor: theme.colors.border }]}
        />
        <LanguageToggle />
      </SettingsSection>

      {user ? (
        <Pressable onPress={() => void signOut()} style={styles.signOut}>
          <Text style={{ color: theme.colors.danger, fontWeight: '800' }}>
            {t('signOut')}
          </Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const { theme } = useTheme();
  const { textDirection } = useLocalization();
  return (
    <View style={styles.section}>
      <Text
        style={[
          styles.sectionLabel,
          textDirection,
          { color: theme.colors.muted },
        ]}
      >
        {title}
      </Text>
      <View style={[styles.panel, { backgroundColor: theme.colors.surface }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { paddingTop: 18, gap: 24 },
  section: { gap: 8 },
  sectionLabel: {
    paddingHorizontal: 4,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  panel: { borderRadius: 17, padding: 14, gap: 12 },
  accountContent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  accountAvatar: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  accountText: { flex: 1, gap: 3 },
  primaryText: { fontSize: 14, fontWeight: '800' },
  secondaryText: { fontSize: 12, lineHeight: 17 },
  emptyText: { paddingVertical: 5, fontSize: 13 },
  separator: { height: StyleSheet.hairlineWidth },
  addressRow: { alignItems: 'center', gap: 8, paddingVertical: 2 },
  addressChoice: { flex: 1, alignItems: 'center', gap: 10 },
  radio: { width: 18, height: 18, borderWidth: 2, borderRadius: 9 },
  addressTextBlock: { flex: 1, gap: 3 },
  labelRow: { alignItems: 'center', gap: 7 },
  defaultBadge: { fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  textButton: { paddingHorizontal: 5, paddingVertical: 10 },
  addAddress: { alignItems: 'center', gap: 8, paddingVertical: 2 },
  segmented: { borderRadius: 13, padding: 3, gap: 3 },
  segment: {
    flex: 1,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  signOut: { alignItems: 'center', paddingVertical: 12 },
});

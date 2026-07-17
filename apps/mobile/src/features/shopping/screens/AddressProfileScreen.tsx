import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { AppButton, Screen } from '@/components';
import { useToast } from '@/components/Toast';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { MessageKey, useLocalization } from '@/localization';
import {
  EgyptAddressProfile,
  createEgyptAddressId,
  emptyEgyptAddress,
  loadEgyptAddressBook,
  saveEgyptAddressRecord,
  validateEgyptAddress,
} from '../address';
import { LabelledInput, StatusMessage } from '../components/ShoppingControls';

const fields: {
  key: keyof EgyptAddressProfile;
  label: MessageKey;
  keyboardType?: 'default' | 'phone-pad' | 'number-pad';
  autoComplete?: 'name' | 'tel' | 'postal-code' | 'street-address' | 'off';
}[] = [
  { key: 'recipientName', label: 'recipientName', autoComplete: 'name' },
  {
    key: 'mobileNumber',
    label: 'mobileNumber',
    keyboardType: 'phone-pad',
    autoComplete: 'tel',
  },
  { key: 'governorate', label: 'governorate' },
  { key: 'cityArea', label: 'cityArea' },
  {
    key: 'street',
    label: 'street',
    autoComplete: 'street-address',
  },
  { key: 'building', label: 'building' },
  { key: 'floor', label: 'floor' },
  { key: 'apartment', label: 'apartment' },
  { key: 'landmark', label: 'landmark' },
  {
    key: 'postalCode',
    label: 'postalCode',
    keyboardType: 'number-pad',
    autoComplete: 'postal-code',
  },
];

type AddressErrors = Partial<
  Record<keyof EgyptAddressProfile, 'required' | 'invalid'>
>;

export function AddressProfileScreen() {
  const params = useLocalSearchParams<{ addressId?: string | string[] }>();
  const requestedAddressId = Array.isArray(params.addressId)
    ? params.addressId[0]
    : params.addressId;
  const { user } = useAuth();
  const { showToast } = useToast();
  const { theme } = useTheme();
  const { t, textDirection } = useLocalization();
  const addressOwnerId = user?.id ?? 'guest';
  const [address, setAddress] =
    useState<EgyptAddressProfile>(emptyEgyptAddress);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [labelError, setLabelError] = useState(false);
  const [errors, setErrors] = useState<AddressErrors>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let active = true;
    loadEgyptAddressBook(addressOwnerId)
      .then((book) => {
        if (!active) return;
        if (requestedAddressId === 'new') {
          setAddressId(null);
          setLabel('');
          setAddress(emptyEgyptAddress());
          return;
        }
        const stored =
          book.addresses.find((record) => record.id === requestedAddressId) ??
          book.addresses.find((record) => record.id === book.defaultAddressId);
        if (stored) {
          setAddressId(stored.id);
          setLabel(stored.label);
          setAddress(stored.profile);
        }
      })
      .catch(() => {
        if (active) {
          showToast(t('addressSaveFailed'), 'error');
        }
      });
    return () => {
      active = false;
    };
  }, [addressOwnerId, requestedAddressId, showToast, t]);

  const save = async () => {
    const nextErrors = validateEgyptAddress(address);
    setErrors(nextErrors);
    setLabelError(!label.trim());
    if (Object.keys(nextErrors).length > 0 || !label.trim()) return;
    setIsSaving(true);
    try {
      const nextId = addressId ?? createEgyptAddressId();
      await saveEgyptAddressRecord(addressOwnerId, {
        id: nextId,
        label,
        profile: address,
      });
      setAddressId(nextId);
      showToast(t('addressSaved'), 'success');
    } catch {
      showToast(t('addressSaveFailed'), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Screen>
      <Text style={[styles.title, textDirection, { color: theme.colors.text }]}>
        {t('addressTitle')}
      </Text>
      <Text
        style={[styles.subtitle, textDirection, { color: theme.colors.muted }]}
      >
        {t('addressSubtitle')}
      </Text>
      {Platform.OS === 'web' ? (
        <View
          style={[
            styles.webNotice,
            { backgroundColor: theme.colors.warningSurface },
          ]}
        >
          <StatusMessage message={t('addressWebNotice')} tone="warning" />
        </View>
      ) : null}
      <View style={styles.fields}>
        <LabelledInput
          error={labelError ? t('requiredField') : undefined}
          label={t('addressLabel')}
          onChangeText={(value) => {
            setLabel(value);
            setLabelError(false);
          }}
          placeholder={t('addressLabelPlaceholder')}
          value={label}
        />
        {fields.map((field) => {
          const error = errors[field.key];
          return (
            <LabelledInput
              autoComplete={field.autoComplete}
              error={
                error === 'invalid'
                  ? t('invalidMobile')
                  : error === 'required'
                    ? t('requiredField')
                    : undefined
              }
              keyboardType={field.keyboardType}
              key={field.key}
              label={t(field.label)}
              onChangeText={(value) => {
                setAddress((current) => ({
                  ...current,
                  [field.key]: value,
                }));
                setErrors((current) => ({
                  ...current,
                  [field.key]: undefined,
                }));
              }}
              value={address[field.key]}
            />
          );
        })}
      </View>
      <AppButton
        disabled={isSaving}
        label={t(isSaving ? 'savingAddress' : 'saveAddress')}
        onPress={() => void save()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: 8, fontSize: 28, lineHeight: 34, fontWeight: '700' },
  subtitle: { fontSize: 15, lineHeight: 22 },
  webNotice: { borderRadius: 14, padding: 13 },
  fields: { gap: 14 },
});

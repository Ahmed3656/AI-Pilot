import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { toWesternDigits } from './currency';

const ADDRESS_KEY = 'dealpilot.egyptAddress.v1';
const webSessionAddresses = new Map<string, string>();

function addressKey(ownerId: string): string {
  const safeOwnerId = ownerId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${ADDRESS_KEY}.${safeOwnerId}`;
}

export interface EgyptAddressProfile {
  recipientName: string;
  mobileNumber: string;
  governorate: string;
  cityOrArea: string;
  street: string;
  building: string;
  floor: string;
  apartment: string;
  landmark: string;
  postalCode: string;
}

export interface EgyptAddressRecord {
  id: string;
  label: string;
  profile: EgyptAddressProfile;
}

export interface EgyptAddressBook {
  defaultAddressId: string | null;
  addresses: EgyptAddressRecord[];
}

export const emptyEgyptAddress = (): EgyptAddressProfile => ({
  recipientName: '',
  mobileNumber: '',
  governorate: '',
  cityOrArea: '',
  street: '',
  building: '',
  floor: '',
  apartment: '',
  landmark: '',
  postalCode: '',
});

export const emptyEgyptAddressBook = (): EgyptAddressBook => ({
  defaultAddressId: null,
  addresses: [],
});

function canonicalStoredProfile(
  value: Partial<EgyptAddressProfile> & { cityArea?: string },
): EgyptAddressProfile {
  const { cityArea, ...canonical } = value;
  return {
    ...emptyEgyptAddress(),
    ...canonical,
    cityOrArea: canonical.cityOrArea || cityArea || '',
  };
}

export function createEgyptAddressId(): string {
  return `address-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeEgyptianMobile(value: string): string {
  const digits = toWesternDigits(value).replace(/\D/g, '');
  if (digits.startsWith('0020')) return `0${digits.slice(4)}`;
  if (digits.startsWith('20')) return `0${digits.slice(2)}`;
  return digits;
}

export function isValidEgyptianMobile(value: string): boolean {
  return /^01[0125]\d{8}$/.test(normalizeEgyptianMobile(value));
}

export function validateEgyptAddress(
  address: EgyptAddressProfile,
): Partial<Record<keyof EgyptAddressProfile, 'required' | 'invalid'>> {
  const errors: Partial<
    Record<keyof EgyptAddressProfile, 'required' | 'invalid'>
  > = {};
  const required: (keyof EgyptAddressProfile)[] = [
    'recipientName',
    'mobileNumber',
    'governorate',
    'cityOrArea',
    'street',
    'building',
    'floor',
    'apartment',
    'landmark',
  ];
  required.forEach((key) => {
    if (!address[key].trim()) errors[key] = 'required';
  });
  if (
    address.mobileNumber.trim() &&
    !isValidEgyptianMobile(address.mobileNumber)
  ) {
    errors.mobileNumber = 'invalid';
  }
  return errors;
}

async function readAddressValue(ownerId: string): Promise<string | null> {
  const key = addressKey(ownerId);
  return Platform.OS === 'web'
    ? (webSessionAddresses.get(key) ?? null)
    : SecureStore.getItemAsync(key);
}

async function writeAddressValue(
  ownerId: string,
  serialized: string,
): Promise<void> {
  const key = addressKey(ownerId);
  if (Platform.OS === 'web') {
    webSessionAddresses.set(key, serialized);
    return;
  }
  await SecureStore.setItemAsync(key, serialized, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function loadEgyptAddressBook(
  ownerId: string,
): Promise<EgyptAddressBook> {
  const serialized = await readAddressValue(ownerId);
  if (!serialized) return emptyEgyptAddressBook();
  const value = JSON.parse(serialized) as
    | Partial<EgyptAddressBook>
    | (Partial<EgyptAddressProfile> & { cityArea?: string });

  if ('addresses' in value && Array.isArray(value.addresses)) {
    const addresses = value.addresses.map((record) => {
      const legacyProfile = record.profile as EgyptAddressProfile & {
        cityArea?: string;
      };
      return {
        id: record.id,
        label: record.label,
        profile: canonicalStoredProfile(legacyProfile),
      };
    });
    const defaultAddressId = addresses.some(
      (record) => record.id === value.defaultAddressId,
    )
      ? (value.defaultAddressId ?? null)
      : (addresses[0]?.id ?? null);
    return { defaultAddressId, addresses };
  }

  const legacyValue = value as Partial<EgyptAddressProfile> & {
    cityArea?: string;
  };
  const legacyProfile = canonicalStoredProfile(legacyValue);
  const legacyId = 'address-legacy';
  return {
    defaultAddressId: legacyId,
    addresses: [{ id: legacyId, label: 'Address 1', profile: legacyProfile }],
  };
}

export async function loadEgyptAddress(
  ownerId: string,
): Promise<EgyptAddressProfile | null> {
  const book = await loadEgyptAddressBook(ownerId);
  const selected =
    book.addresses.find((record) => record.id === book.defaultAddressId) ??
    book.addresses[0];
  return selected ? { ...selected.profile } : null;
}

export async function saveEgyptAddressRecord(
  ownerId: string,
  record: EgyptAddressRecord,
): Promise<EgyptAddressBook> {
  const book = await loadEgyptAddressBook(ownerId);
  const normalized = {
    ...record,
    label: record.label.trim(),
    profile: {
      ...record.profile,
      mobileNumber: normalizeEgyptianMobile(record.profile.mobileNumber),
    },
  };
  const existingIndex = book.addresses.findIndex(
    (item) => item.id === record.id,
  );
  const addresses = [...book.addresses];
  if (existingIndex >= 0) addresses[existingIndex] = normalized;
  else addresses.push(normalized);
  const next = {
    addresses,
    defaultAddressId: book.defaultAddressId ?? normalized.id,
  };
  await writeAddressValue(ownerId, JSON.stringify(next));
  return next;
}

export async function setDefaultEgyptAddress(
  ownerId: string,
  addressId: string,
): Promise<EgyptAddressBook> {
  const book = await loadEgyptAddressBook(ownerId);
  if (!book.addresses.some((record) => record.id === addressId)) {
    throw new Error('ADDRESS_NOT_FOUND');
  }
  const next = { ...book, defaultAddressId: addressId };
  await writeAddressValue(ownerId, JSON.stringify(next));
  return next;
}

export function clearTemporaryAddress(
  profile: EgyptAddressProfile | null,
): void {
  if (!profile) return;
  (Object.keys(profile) as (keyof EgyptAddressProfile)[]).forEach((key) => {
    profile[key] = '';
  });
}

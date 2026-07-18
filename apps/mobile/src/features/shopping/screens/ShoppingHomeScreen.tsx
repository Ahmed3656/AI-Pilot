import { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Href, router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { AuthenticationSessionExpiredError } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { AppButton } from '@/components';
import { useToast } from '@/components/Toast';
import { useTheme } from '@/contexts/ThemeContext';
import { MessageKey, useLocalization } from '@/localization';
import { detectShoppingCategory } from '../clarification';
import {
  ActiveShoppingRunError,
  createShoppingRun,
  replaceActiveShoppingRun,
  ShoppingBrowserBusyError,
} from '../shopping.service';
import {
  CreateShoppingRunRequest,
  RequestedCategory,
  ShoppingCategory,
} from '../types';
import { EgyptAddressRecord, loadEgyptAddressBook } from '../address';
import { ChoiceChip } from '../components/ShoppingControls';

const examples: { category: ShoppingCategory; key: MessageKey }[] = [
  { category: 'retail', key: 'exampleRetail' },
  { category: 'food', key: 'exampleFood' },
  { category: 'cinema', key: 'exampleCinema' },
];

const categoryChoices: RequestedCategory[] = [
  'auto',
  'retail',
  'food',
  'cinema',
];

export function ShoppingHomeScreen() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { theme } = useTheme();
  const { locale, t, textDirection, rowDirection } = useLocalization();
  const [request, setRequest] = useState('');
  const [categorySelection, setCategorySelection] =
    useState<RequestedCategory>('auto');
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const [activeConflict, setActiveConflict] = useState<{
    runId: string;
    request: CreateShoppingRunRequest;
  } | null>(null);
  const [defaultAddress, setDefaultAddress] =
    useState<EgyptAddressRecord | null>(null);
  const addressOwnerId = user?.id ?? 'guest';
  const detectedCategory = useMemo(
    () => detectShoppingCategory(request),
    [request],
  );
  const activeCategoryLabel =
    categorySelection === 'auto' && detectedCategory
      ? t(detectedCategory)
      : t(categorySelection);
  const avatar = (
    user?.displayName?.trim()[0] ??
    user?.email?.trim()[0] ??
    'D'
  ).toLocaleUpperCase();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadEgyptAddressBook(addressOwnerId)
        .then((book) => {
          if (!active) return;
          setDefaultAddress(
            book.addresses.find(
              (record) => record.id === book.defaultAddressId,
            ) ?? null,
          );
        })
        .catch(() => {
          if (active) setDefaultAddress(null);
        });
      return () => {
        active = false;
      };
    }, [addressOwnerId]),
  );

  const chooseExample = (value: string) => {
    setRequest(value);
    setCategorySelection('auto');
    setShowCategoryMenu(false);
  };

  const startRun = async () => {
    if (!request.trim()) {
      showToast(t('requestRequired'), 'warning');
      return;
    }
    const nextRequest: CreateShoppingRunRequest = {
      query: request.trim(),
      locale,
      category: categorySelection,
    };
    setIsStarting(true);
    try {
      const run = await createShoppingRun(nextRequest);
      router.push(`/run/${run.id}` as Href);
    } catch (error) {
      if (error instanceof ActiveShoppingRunError) {
        setActiveConflict({ runId: error.runId, request: nextRequest });
      } else if (error instanceof AuthenticationSessionExpiredError) {
        showToast(t('authSessionExpired'), 'warning', 5000);
      } else {
        showToast(
          t(
            error instanceof ShoppingBrowserBusyError
              ? 'shoppingBrowserBusy'
              : 'startFailed',
          ),
          error instanceof ShoppingBrowserBusyError ? 'warning' : 'error',
        );
      }
    } finally {
      setIsStarting(false);
    }
  };

  const continueActiveRun = () => {
    if (!activeConflict) return;
    const runId = activeConflict.runId;
    setActiveConflict(null);
    router.push(`/run/${runId}` as Href);
  };

  const cancelAndStartRun = async () => {
    if (!activeConflict) return;
    setIsReplacing(true);
    try {
      const run = await replaceActiveShoppingRun(
        activeConflict.runId,
        activeConflict.request,
      );
      setActiveConflict(null);
      router.push(`/run/${run.id}` as Href);
    } catch (error) {
      if (error instanceof ActiveShoppingRunError) {
        setActiveConflict((current) =>
          current ? { ...current, runId: error.runId } : current,
        );
      } else {
        showToast(t('replaceRunFailed'), 'error', 5000);
      }
    } finally {
      setIsReplacing(false);
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
          <View style={[styles.header, rowDirection]}>
            <View
              style={[
                styles.marketPill,
                { backgroundColor: theme.colors.surface },
              ]}
            >
              <Text style={{ color: theme.colors.muted, fontWeight: '700' }}>
                Egypt · EGP
              </Text>
            </View>
            <Text
              pointerEvents="none"
              style={[styles.brand, { color: theme.colors.text }]}
            >
              {t('appName')}
            </Text>
            <Pressable
              accessibilityLabel={t('account')}
              accessibilityRole="button"
              onPress={() => router.push('/settings')}
              style={[
                styles.avatar,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              <Text style={{ color: theme.colors.text, fontWeight: '800' }}>
                {avatar}
              </Text>
            </Pressable>
          </View>

          <View style={styles.hero}>
            <Text
              style={[
                styles.title,
                textDirection,
                { color: theme.colors.text },
              ]}
            >
              {t('homeTitle')}
            </Text>
            <Text
              style={[
                styles.subtitle,
                textDirection,
                { color: theme.colors.muted },
              ]}
            >
              {t('homeSubtitle')}
            </Text>
          </View>

          <ScrollView
            contentContainerStyle={styles.examples}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.exampleScroller}
          >
            {examples.map((example) => (
              <Pressable
                key={example.category}
                onPress={() => chooseExample(t(example.key))}
                style={({ pressed }) => [
                  styles.example,
                  {
                    backgroundColor: theme.colors.surface,
                    opacity: pressed ? 0.72 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.exampleCategory,
                    textDirection,
                    { color: theme.colors.primary },
                  ]}
                >
                  {t(example.category)}
                </Text>
                <Text
                  numberOfLines={2}
                  style={[
                    styles.exampleText,
                    textDirection,
                    { color: theme.colors.text },
                  ]}
                >
                  {t(example.key)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.spacer} />

          <Pressable
            accessibilityLabel={t('deliveryAddress')}
            accessibilityRole="button"
            onPress={() =>
              router.push(
                defaultAddress
                  ? {
                      pathname: '/address',
                      params: { addressId: defaultAddress.id },
                    }
                  : { pathname: '/address', params: { addressId: 'new' } },
              )
            }
            style={({ pressed }) => [
              styles.addressBar,
              rowDirection,
              {
                backgroundColor: theme.colors.surface,
                opacity: pressed ? 0.72 : 1,
              },
            ]}
          >
            <Text style={{ color: theme.colors.primary, fontSize: 17 }}>⌖</Text>
            <View style={styles.addressSummary}>
              <Text
                style={[
                  styles.addressTitle,
                  textDirection,
                  { color: theme.colors.text },
                ]}
              >
                {t('deliveryAddress')}
              </Text>
              <Text
                numberOfLines={1}
                style={[
                  styles.addressValue,
                  textDirection,
                  { color: theme.colors.muted },
                ]}
              >
                {defaultAddress
                  ? `${defaultAddress.label} · ${defaultAddress.profile.cityOrArea}, ${defaultAddress.profile.governorate}`
                  : t('noSavedAddresses')}
              </Text>
            </View>
            <Text style={{ color: theme.colors.muted, fontSize: 20 }}>›</Text>
          </Pressable>

          <View
            style={[
              styles.composer,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
              },
            ]}
          >
            {showCategoryMenu ? (
              <View style={[styles.chips, rowDirection]}>
                {categoryChoices.map((category) => (
                  <ChoiceChip
                    key={category}
                    label={t(category)}
                    onPress={() => {
                      setCategorySelection(category);
                      setShowCategoryMenu(false);
                    }}
                    selected={categorySelection === category}
                  />
                ))}
              </View>
            ) : null}

            <TextInput
              accessibilityLabel={t('requestLabel')}
              multiline
              onChangeText={(value) => {
                setRequest(value);
              }}
              placeholder={t('requestPlaceholder')}
              placeholderTextColor={theme.colors.muted}
              style={[
                styles.input,
                textDirection,
                { color: theme.colors.text },
              ]}
              value={request}
            />

            <View style={[styles.composerFooter, rowDirection]}>
              <View style={[styles.tools, rowDirection]}>
                <Pressable
                  accessibilityLabel={`${t('categoryTitle')}: ${activeCategoryLabel}`}
                  accessibilityRole="button"
                  onPress={() => setShowCategoryMenu((current) => !current)}
                  style={[
                    styles.toolButton,
                    { backgroundColor: theme.colors.background },
                  ]}
                >
                  <Text style={{ color: theme.colors.text, fontWeight: '700' }}>
                    ✦ {activeCategoryLabel}
                  </Text>
                </Pressable>
              </View>
              <Pressable
                accessibilityLabel={t('sendRequest')}
                accessibilityRole="button"
                disabled={isStarting || !request.trim()}
                onPress={() => void startRun()}
                style={({ pressed }) => [
                  styles.send,
                  {
                    backgroundColor: theme.colors.primary,
                    opacity:
                      isStarting || !request.trim() ? 0.35 : pressed ? 0.75 : 1,
                  },
                ]}
              >
                <Text
                  style={[styles.sendIcon, { color: theme.colors.primaryText }]}
                >
                  {isStarting ? '…' : '↑'}
                </Text>
              </Pressable>
            </View>
          </View>

          {categorySelection === 'auto' && !detectedCategory ? (
            <Text
              style={[
                styles.autoHint,
                textDirection,
                { color: theme.colors.muted },
              ]}
            >
              {t('autoWillDetect')}
            </Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        animationType="fade"
        onRequestClose={() => {
          if (!isReplacing) setActiveConflict(null);
        }}
        transparent
        visible={Boolean(activeConflict)}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel={t('keepActiveRun')}
            accessibilityRole="button"
            disabled={isReplacing}
            onPress={() => setActiveConflict(null)}
            style={styles.backdrop}
          />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
              },
            ]}
          >
            <View style={styles.sheetDragArea}>
              <View
                style={[
                  styles.sheetHandle,
                  { backgroundColor: theme.colors.border },
                ]}
              />
            </View>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetTitleBlock}>
                <Text
                  style={[
                    styles.sheetTitle,
                    textDirection,
                    { color: theme.colors.text },
                  ]}
                >
                  {t('activeRunTitle')}
                </Text>
                <Text
                  style={[
                    styles.sheetHint,
                    textDirection,
                    { color: theme.colors.muted },
                  ]}
                >
                  {t('activeRunBody')}
                </Text>
              </View>
            </View>
            <View style={styles.fields}>
              <AppButton
                disabled={isReplacing}
                label={t('continueActiveRun')}
                onPress={continueActiveRun}
              />
              <AppButton
                disabled={isReplacing}
                label={t(isReplacing ? 'replacingRun' : 'cancelAndStartRun')}
                onPress={() => void cancelAndStartRun()}
                variant="danger"
              />
              <AppButton
                disabled={isReplacing}
                label={t('keepActiveRun')}
                onPress={() => setActiveConflict(null)}
                variant="secondary"
              />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, padding: 16, gap: 16 },
  header: {
    minHeight: 36,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  marketPill: { borderRadius: 15, paddingHorizontal: 10, paddingVertical: 7 },
  brand: {
    position: 'absolute',
    left: 0,
    right: 0,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: { alignItems: 'center', gap: 8, marginTop: 52 },
  title: {
    fontSize: 29,
    lineHeight: 36,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    maxWidth: 520,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  exampleScroller: {
    width: '100%',
    height: 92,
    maxWidth: 680,
    alignSelf: 'center',
    flexGrow: 0,
  },
  examples: { gap: 10, paddingHorizontal: 1 },
  example: {
    width: 238,
    height: 92,
    borderRadius: 16,
    padding: 14,
    gap: 6,
  },
  exampleCategory: { fontSize: 11, fontWeight: '800' },
  exampleText: { fontSize: 13, lineHeight: 18 },
  spacer: { flexGrow: 1, minHeight: 26 },
  addressBar: {
    width: '100%',
    maxWidth: 760,
    minHeight: 54,
    alignSelf: 'center',
    alignItems: 'center',
    borderRadius: 15,
    paddingHorizontal: 14,
    gap: 10,
  },
  addressSummary: { flex: 1, gap: 1 },
  addressTitle: { fontSize: 13, fontWeight: '800' },
  addressValue: { fontSize: 12, lineHeight: 17 },
  composer: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 25,
    padding: 10,
    gap: 8,
  },
  chips: { flexWrap: 'wrap', gap: 6, paddingHorizontal: 4, paddingTop: 3 },
  input: {
    minHeight: 72,
    maxHeight: 160,
    paddingHorizontal: 7,
    paddingVertical: 8,
    fontSize: 16,
    lineHeight: 23,
    textAlignVertical: 'top',
  },
  composerFooter: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 10,
  },
  tools: { flex: 1, flexWrap: 'wrap', gap: 6 },
  toolButton: {
    minHeight: 34,
    justifyContent: 'center',
    borderRadius: 17,
    paddingHorizontal: 11,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendIcon: { fontSize: 23, lineHeight: 26, fontWeight: '900' },
  autoHint: { alignSelf: 'center', fontSize: 11, lineHeight: 16 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.52)',
  },
  sheet: {
    maxHeight: '82%',
    borderTopWidth: 1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 18,
    paddingTop: 2,
    paddingBottom: 26,
    gap: 15,
  },
  sheetDragArea: {
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetHandle: {
    width: 38,
    height: 4,
    alignSelf: 'center',
    borderRadius: 2,
  },
  sheetHeader: { alignItems: 'flex-start', gap: 12 },
  sheetTitleBlock: { flex: 1, gap: 3 },
  sheetTitle: { fontSize: 20, fontWeight: '800' },
  sheetHint: { fontSize: 13, lineHeight: 18 },
  fields: { gap: 13, paddingBottom: 8 },
});

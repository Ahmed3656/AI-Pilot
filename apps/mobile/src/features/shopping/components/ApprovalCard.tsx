import { StyleSheet, Text, View } from 'react-native';
import { AppButton, Card } from '@/components';
import { useTheme } from '@/contexts/ThemeContext';
import { useLocalization } from '@/localization';
import { RunApproval } from '../types';

export function ApprovalCard({
  approval,
  busy,
  onDecision,
}: {
  approval: RunApproval;
  busy: boolean;
  onDecision: (decision: 'approved' | 'declined') => void;
}) {
  const { theme } = useTheme();
  const { t, textDirection, rowDirection, locale } = useLocalization();
  const title =
    approval.type === 'address_share'
      ? t('addressConsent')
      : approval.type === 'seat_hold'
        ? t('seatHoldApproval')
        : t('merchantApproval');
  const body =
    approval.type === 'address_share'
      ? t('addressConsentBody')
      : approval.type === 'seat_hold'
        ? t('seatHoldBody')
        : t('merchantApprovalBody');
  const merchant = approval.merchant.branch
    ? `${approval.merchant.name} · ${approval.merchant.branch}`
    : approval.merchant.name;

  return (
    <Card>
      <Text style={[styles.title, textDirection, { color: theme.colors.text }]}>
        {title}
      </Text>
      {approval.type === 'address_share' ? (
        <Text
          style={[
            styles.consentPrefix,
            textDirection,
            { color: theme.colors.warning },
          ]}
        >
          {t('addressConsentPrefix')}
        </Text>
      ) : null}
      <View style={[styles.merchant, { borderColor: theme.colors.primary }]}>
        <Text
          style={[
            styles.merchantName,
            textDirection,
            { color: theme.colors.primary },
          ]}
        >
          {merchant}
        </Text>
      </View>
      <Text style={[styles.body, textDirection, { color: theme.colors.muted }]}>
        {approval.summary ?? body}
      </Text>
      {approval.type === 'address_share' && approval.summary ? (
        <Text
          style={[styles.body, textDirection, { color: theme.colors.muted }]}
        >
          {body}
        </Text>
      ) : null}
      {approval.expiresAt ? (
        <Text
          style={[
            styles.expires,
            textDirection,
            { color: theme.colors.warning },
          ]}
        >
          {new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(new Date(approval.expiresAt))}
        </Text>
      ) : null}
      <View style={[styles.actions, rowDirection]}>
        <AppButton
          disabled={busy}
          label={t(busy ? 'approving' : 'approve')}
          onPress={() => onDecision('approved')}
          style={styles.action}
        />
        <AppButton
          disabled={busy}
          label={t('decline')}
          onPress={() => onDecision('declined')}
          style={styles.action}
          variant="secondary"
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '800' },
  consentPrefix: { fontSize: 14, lineHeight: 20, fontWeight: '800' },
  merchant: {
    borderStartWidth: 3,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  merchantName: { fontSize: 17, fontWeight: '900' },
  body: { fontSize: 14, lineHeight: 20 },
  expires: { fontSize: 13, fontWeight: '700' },
  actions: { gap: 10, marginTop: 4 },
  action: { flex: 1 },
});

import { StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components';
import { useTheme } from '@/contexts/ThemeContext';
import { useLocalization } from '@/localization';
import { formatEGP } from '../currency';
import { ShoppingCandidate } from '../types';

export function CandidateCard({
  candidate,
  isLowest,
}: {
  candidate: ShoppingCandidate;
  isLowest: boolean;
}) {
  const { theme } = useTheme();
  const { locale, t, textDirection, rowDirection } = useLocalization();
  const lines = [
    ['subtotal', candidate.breakdown.subtotal],
    ['delivery', candidate.breakdown.delivery],
    ['serviceFee', candidate.breakdown.serviceFee],
    ['taxes', candidate.breakdown.taxes],
    ['discount', candidate.breakdown.discount],
  ] as const;

  return (
    <Card>
      <View style={[styles.header, rowDirection]}>
        <View style={styles.headerText}>
          <Text
            style={[
              styles.merchant,
              textDirection,
              { color: theme.colors.primary },
            ]}
          >
            {candidate.merchant}
          </Text>
          <Text
            style={[styles.title, textDirection, { color: theme.colors.text }]}
          >
            {candidate.title}
          </Text>
          {candidate.detail ? (
            <Text
              style={[
                styles.detail,
                textDirection,
                { color: theme.colors.muted },
              ]}
            >
              {candidate.detail}
            </Text>
          ) : null}
        </View>
        {isLowest ? (
          <View
            style={[
              styles.lowestBadge,
              { backgroundColor: theme.colors.success },
            ]}
          >
            <Text style={styles.lowestText}>{t('lowestVerified')}</Text>
          </View>
        ) : null}
      </View>

      {candidate.rating !== null && candidate.rating !== undefined ? (
        <Text
          style={[styles.meta, textDirection, { color: theme.colors.muted }]}
        >
          {t('rating')}:{' '}
          {new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', {
            maximumFractionDigits: 1,
          }).format(candidate.rating)}
        </Text>
      ) : null}
      {candidate.venue ? (
        <Text
          style={[styles.meta, textDirection, { color: theme.colors.muted }]}
        >
          {t('venue')}: {candidate.venue}
        </Text>
      ) : null}
      {candidate.showtime ? (
        <Text
          style={[styles.meta, textDirection, { color: theme.colors.muted }]}
        >
          {t('showtime')}: {candidate.showtime}
        </Text>
      ) : null}

      <View style={[styles.breakdown, { borderColor: theme.colors.border }]}>
        {lines.map(([label, amount]) => (
          <View key={label} style={[styles.line, rowDirection]}>
            <Text style={[textDirection, { color: theme.colors.muted }]}>
              {t(label)}
            </Text>
            <Text style={[styles.amount, { color: theme.colors.text }]}>
              {formatEGP(amount, locale)}
            </Text>
          </View>
        ))}
        <View
          style={[
            styles.totalLine,
            rowDirection,
            { borderColor: theme.colors.border },
          ]}
        >
          <Text
            style={[
              styles.totalLabel,
              textDirection,
              { color: theme.colors.text },
            ]}
          >
            {t('total')}
          </Text>
          <Text
            style={[
              styles.total,
              {
                color: candidate.isComplete
                  ? theme.colors.success
                  : theme.colors.muted,
              },
            ]}
          >
            {formatEGP(candidate.breakdown.total, locale)}
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.reason,
          {
            backgroundColor: candidate.isComplete
              ? theme.colors.background
              : theme.colors.warningSurface,
          },
        ]}
      >
        <Text
          style={[
            styles.reasonLabel,
            textDirection,
            { color: theme.colors.text },
          ]}
        >
          {t('incompleteReason')}
        </Text>
        <Text
          style={[
            styles.reasonText,
            textDirection,
            {
              color: candidate.isComplete
                ? theme.colors.success
                : theme.colors.warning,
            },
          ]}
        >
          {candidate.isComplete
            ? t('completeReason')
            : candidate.incompleteReason || t('unavailableReason')}
        </Text>
      </View>

      {candidate.verifiedAt ? (
        <Text
          style={[
            styles.verified,
            textDirection,
            { color: theme.colors.muted },
          ]}
        >
          {t('verifiedAt')}:{' '}
          {new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(new Date(candidate.verifiedAt))}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'flex-start', gap: 10 },
  headerText: { flex: 1, gap: 3 },
  merchant: { fontSize: 13, fontWeight: '900', textTransform: 'uppercase' },
  title: { fontSize: 18, lineHeight: 24, fontWeight: '800' },
  detail: { fontSize: 14, lineHeight: 20 },
  lowestBadge: {
    maxWidth: 132,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  lowestText: {
    color: '#FFFFFF',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '900',
  },
  meta: { fontSize: 13 },
  breakdown: { borderTopWidth: 1, paddingTop: 8, gap: 8 },
  line: { alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  amount: { fontSize: 14, fontWeight: '700' },
  totalLine: {
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: 1,
    paddingTop: 10,
    marginTop: 2,
  },
  totalLabel: { fontSize: 16, fontWeight: '900' },
  total: { fontSize: 18, fontWeight: '900' },
  reason: { borderRadius: 10, padding: 11, gap: 4 },
  reasonLabel: { fontSize: 12, fontWeight: '900' },
  reasonText: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  verified: { fontSize: 11 },
});

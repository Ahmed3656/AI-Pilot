import { StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components';
import { useTheme } from '@/contexts/ThemeContext';
import { useLocalization } from '@/localization';
import { formatEGP } from '../currency';
import { OfferReport } from '../types';

function offerDetails(offer: OfferReport): string[] {
  switch (offer.details.kind) {
    case 'retail':
      return [
        `${offer.details.brand} ${offer.details.model}`,
        offer.details.variant,
        offer.details.storage,
        offer.details.size,
        offer.details.color,
        `×${offer.details.quantity}`,
        offer.details.deliveryEstimate,
      ].filter((value): value is string => Boolean(value));
    case 'food':
      return [
        offer.details.restaurant,
        offer.details.meal,
        offer.details.size,
        ...offer.details.modifiers,
        offer.details.rating === null ? null : `★ ${offer.details.rating}`,
        offer.details.deliveryEstimate,
      ].filter((value): value is string => Boolean(value));
    case 'cinema':
      return [
        offer.details.movie,
        offer.details.venue,
        `${offer.details.date} · ${offer.details.showtime}`,
        `${offer.details.language} · ${offer.details.screenFormat}`,
        `${offer.details.seatCount} · ${offer.details.seatType}`,
      ];
  }
}

export function CandidateCard({
  offer,
  validity,
  isWinner,
}: {
  offer: OfferReport;
  validity: 'valid' | 'excluded' | 'incomplete';
  isWinner: boolean;
}) {
  const { theme } = useTheme();
  const { locale, t, textDirection, rowDirection } = useLocalization();
  const lines = [
    [t('subtotal'), offer.price.itemSubtotal],
    [t('delivery'), offer.price.deliveryFee],
    [t('serviceFee'), offer.price.serviceFee],
    [t('bookingFee'), offer.price.bookingFee],
    [t('taxes'), offer.price.tax],
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
            {offer.merchantName} · {offer.merchantDomain}
          </Text>
          <Text
            style={[styles.title, textDirection, { color: theme.colors.text }]}
          >
            {offer.title}
          </Text>
          <Text
            style={[
              styles.detail,
              textDirection,
              { color: theme.colors.muted },
            ]}
          >
            {offerDetails(offer).join(' · ')}
          </Text>
        </View>
        {isWinner ? (
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

      <Text style={[styles.meta, textDirection, { color: theme.colors.muted }]}>
        {t('match')}: {offer.match.exact ? t('exactMatch') : t('notExact')} ·{' '}
        {Math.round(offer.match.confidence * 100)}%
      </Text>
      <Text style={[styles.meta, textDirection, { color: theme.colors.muted }]}>
        {offer.match.explanation}
      </Text>

      <View style={[styles.breakdown, { borderColor: theme.colors.border }]}>
        {lines.map(([label, amount]) => (
          <View key={label} style={[styles.line, rowDirection]}>
            <Text style={[textDirection, { color: theme.colors.muted }]}>
              {label}
            </Text>
            <Text style={[styles.amount, { color: theme.colors.text }]}>
              {formatEGP(amount, locale)}
            </Text>
          </View>
        ))}
        {offer.price.mandatoryFees.map((fee) => (
          <View
            key={`${fee.label}-${fee.amount}`}
            style={[styles.line, rowDirection]}
          >
            <Text style={[textDirection, { color: theme.colors.muted }]}>
              {fee.label}
            </Text>
            <Text style={[styles.amount, { color: theme.colors.text }]}>
              {formatEGP(fee.amount, locale)}
            </Text>
          </View>
        ))}
        <View style={[styles.line, rowDirection]}>
          <Text style={[textDirection, { color: theme.colors.muted }]}>
            {t('discount')}
          </Text>
          <Text style={[styles.amount, { color: theme.colors.success }]}>
            − {formatEGP(offer.price.verifiedDiscount, locale)}
          </Text>
        </View>
        {offer.details.kind === 'food' ? (
          <View style={[styles.line, rowDirection]}>
            <Text style={[textDirection, { color: theme.colors.muted }]}>
              {t('optionalTip')}
            </Text>
            <Text style={[styles.amount, { color: theme.colors.text }]}>
              {formatEGP(offer.price.optionalTip, locale)} · {t('excluded')}
            </Text>
          </View>
        ) : null}
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
                color:
                  validity === 'valid'
                    ? theme.colors.success
                    : theme.colors.muted,
              },
            ]}
          >
            {formatEGP(offer.price.finalTotal, locale)}
          </Text>
        </View>
      </View>

      {validity !== 'valid' ? (
        <View
          style={[
            styles.reason,
            { backgroundColor: theme.colors.warningSurface },
          ]}
        >
          <Text
            style={[
              styles.reasonLabel,
              textDirection,
              { color: theme.colors.text },
            ]}
          >
            {validity === 'excluded'
              ? t('exclusionReason')
              : t('incompleteReason')}
          </Text>
          <Text
            style={[
              styles.reasonText,
              textDirection,
              { color: theme.colors.warning },
            ]}
          >
            {validity === 'excluded'
              ? offer.exclusionReason || t('unknownReason')
              : offer.incompleteFields.join(', ') || t('unknownReason')}
          </Text>
        </View>
      ) : null}

      <Text
        style={[styles.verified, textDirection, { color: theme.colors.muted }]}
      >
        {t('evidence')}: {offer.evidenceIds.join(', ')}
      </Text>
      <Text
        style={[styles.verified, textDirection, { color: theme.colors.muted }]}
      >
        {t('verifiedAt')}:{' '}
        {new Intl.DateTimeFormat(locale, {
          timeZone: 'Africa/Cairo',
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(offer.observedAt))}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'flex-start', gap: 10 },
  headerText: { flex: 1, gap: 3 },
  merchant: { fontSize: 13, fontWeight: '900' },
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
  meta: { fontSize: 13, lineHeight: 18 },
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
  verified: { fontSize: 11, lineHeight: 16 },
});

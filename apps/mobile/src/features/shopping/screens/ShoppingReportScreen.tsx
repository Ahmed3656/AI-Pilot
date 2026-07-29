import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Card, Screen } from '@/components';
import { useToast } from '@/components/Toast';
import { useTheme } from '@/contexts/ThemeContext';
import { useLocalization } from '@/localization';
import { CandidateCard } from '../components/CandidateCard';
import { EvidenceGallery } from '../components/RunTimeline';
import { LanguageToggle, SectionHeading } from '../components/ShoppingControls';
import { formatEGP } from '../currency';
import { presentOffers, warningListKey } from '../report';
import { getShoppingReport } from '../shopping.service';

export function ShoppingReportScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const runId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { theme } = useTheme();
  const { showToast } = useToast();
  const { t, locale, textDirection, rowDirection } = useLocalization();
  const report = useQuery({
    queryKey: ['shopping-report', runId],
    queryFn: () => getShoppingReport(runId ?? ''),
    enabled: Boolean(runId),
    refetchInterval: (query) =>
      query.state.data?.status === 'in_progress' ? 5_000 : false,
  });
  const errorShown = useRef(false);
  useEffect(() => {
    if (report.isError && !errorShown.current) {
      errorShown.current = true;
      showToast(t('reportLoadFailed'), 'error');
    } else if (!report.isError) {
      errorShown.current = false;
    }
  }, [report.isError, showToast, t]);
  const offers = report.data ? presentOffers(report.data) : [];

  return (
    <Screen>
      <View style={[styles.topBar, rowDirection]}>
        <View style={styles.headingBlock}>
          <Text
            style={[
              styles.brand,
              textDirection,
              { color: theme.colors.primary },
            ]}
          >
            {t('appName')}
          </Text>
          <Text
            style={[styles.title, textDirection, { color: theme.colors.text }]}
          >
            {t('reportTitle')}
          </Text>
        </View>
        <LanguageToggle />
      </View>
      <Text
        style={[styles.subtitle, textDirection, { color: theme.colors.muted }]}
      >
        {t('reportSubtitle')}
      </Text>

      {report.data ? (
        <>
          <Card>
            <Text
              style={[
                styles.claimLabel,
                textDirection,
                { color: theme.colors.text },
              ]}
            >
              {report.data.conclusion?.statement ?? t('reportInProgress')}
            </Text>
            <Text
              style={[
                styles.reportMeta,
                textDirection,
                { color: theme.colors.muted },
              ]}
            >
              {report.data.category ?? t('auto')} · {report.data.market} ·{' '}
              {report.data.currency} · {report.data.status}
            </Text>
          </Card>

          <View style={styles.section}>
            <SectionHeading title={t('merchantProgress')} />
            {report.data.merchantAttempts.map((attempt) => (
              <Card key={attempt.id}>
                <Text
                  style={[
                    styles.itemTitle,
                    textDirection,
                    { color: theme.colors.text },
                  ]}
                >
                  {attempt.merchantName} · {attempt.merchantDomain}
                </Text>
                <Text
                  style={[
                    styles.itemBody,
                    textDirection,
                    {
                      color:
                        attempt.outcome === 'succeeded'
                          ? theme.colors.success
                          : theme.colors.warning,
                    },
                  ]}
                >
                  {attempt.outcome}
                  {attempt.failureCode ? ` · ${attempt.failureCode}` : ''}
                </Text>
                {attempt.message ? (
                  <Text
                    style={[
                      styles.itemBody,
                      textDirection,
                      { color: theme.colors.muted },
                    ]}
                  >
                    {attempt.message}
                  </Text>
                ) : null}
              </Card>
            ))}
          </View>

          <View style={styles.section}>
            <SectionHeading title={t('offers')} />
            {offers.length ? (
              offers.map(({ offer, validity, isWinner }) => (
                <View key={offer.id} style={styles.offerGroup}>
                  <Text
                    style={[
                      styles.validity,
                      textDirection,
                      {
                        color:
                          validity === 'valid'
                            ? theme.colors.success
                            : theme.colors.warning,
                      },
                    ]}
                  >
                    {t(validity)}
                  </Text>
                  <CandidateCard
                    isWinner={isWinner}
                    offer={offer}
                    validity={validity}
                  />
                </View>
              ))
            ) : (
              <Text style={[textDirection, { color: theme.colors.muted }]}>
                {t('noOffers')}
              </Text>
            )}
          </View>

          {report.data.couponAttempts.length ? (
            <View style={styles.section}>
              <SectionHeading title={t('couponAttempts')} />
              {report.data.couponAttempts.map((coupon) => (
                <Card key={coupon.id}>
                  <Text
                    style={[
                      styles.itemTitle,
                      textDirection,
                      { color: theme.colors.text },
                    ]}
                  >
                    {coupon.code} · {coupon.merchantDomain}
                  </Text>
                  <Text
                    style={[
                      styles.itemBody,
                      textDirection,
                      {
                        color:
                          coupon.status === 'verified'
                            ? theme.colors.success
                            : theme.colors.warning,
                      },
                    ]}
                  >
                    {coupon.status}
                    {coupon.rejectionReason
                      ? ` · ${coupon.rejectionReason}`
                      : ''}
                  </Text>
                  <Text
                    style={[
                      styles.itemBody,
                      textDirection,
                      { color: theme.colors.muted },
                    ]}
                  >
                    {formatEGP(coupon.beforeTotal, locale)} →{' '}
                    {formatEGP(coupon.afterTotal, locale)} · {t('discount')}{' '}
                    {formatEGP(coupon.verifiedDiscount, locale)}
                  </Text>
                  {coupon.message ? (
                    <Text
                      style={[
                        styles.itemBody,
                        textDirection,
                        { color: theme.colors.muted },
                      ]}
                    >
                      {coupon.message}
                    </Text>
                  ) : null}
                  <Text
                    style={[
                      styles.evidenceIds,
                      textDirection,
                      { color: theme.colors.muted },
                    ]}
                  >
                    {t('evidence')}: {coupon.evidenceIds.join(', ')}
                  </Text>
                </Card>
              ))}
            </View>
          ) : null}

          {report.data.warnings.length ? (
            <Card>
              <SectionHeading title={t('warnings')} />
              {report.data.warnings.map((warning, index) => (
                <Text
                  key={warningListKey(warning, index)}
                  style={[
                    styles.itemBody,
                    textDirection,
                    { color: theme.colors.warning },
                  ]}
                >
                  • {warning.code} · {warning.message}
                </Text>
              ))}
            </Card>
          ) : null}

          {report.data.partialFailures.length ? (
            <Card>
              <SectionHeading title={t('partialFailures')} />
              {report.data.partialFailures.map((failure) => (
                <Text
                  key={`${failure.merchantAttemptId}-${failure.code}`}
                  style={[
                    styles.itemBody,
                    textDirection,
                    { color: theme.colors.warning },
                  ]}
                >
                  • {failure.code} · {failure.message} ·{' '}
                  {failure.retryable ? t('retryable') : t('notRetryable')}
                </Text>
              ))}
            </Card>
          ) : null}

          {report.data.evidence.length ? (
            <View style={styles.section}>
              <SectionHeading title={t('evidence')} />
              <EvidenceGallery evidence={report.data.evidence} />
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    marginTop: 12,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headingBlock: { flex: 1, gap: 6 },
  brand: { fontSize: 16, fontWeight: '900' },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '800' },
  subtitle: { fontSize: 15, lineHeight: 22 },
  claimLabel: { fontSize: 16, lineHeight: 23, fontWeight: '800' },
  reportMeta: { fontSize: 12, lineHeight: 18 },
  section: { gap: 10 },
  offerGroup: { gap: 5 },
  validity: { fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  itemTitle: { fontSize: 15, lineHeight: 21, fontWeight: '800' },
  itemBody: { fontSize: 13, lineHeight: 19 },
  evidenceIds: { fontSize: 11, lineHeight: 16 },
});

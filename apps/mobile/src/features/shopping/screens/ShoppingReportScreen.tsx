import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Card, Screen } from '@/components';
import { useToast } from '@/components/Toast';
import { useTheme } from '@/contexts/ThemeContext';
import { useLocalization } from '@/localization';
import { CandidateCard } from '../components/CandidateCard';
import { LanguageToggle } from '../components/ShoppingControls';
import { formatEGP } from '../currency';
import { lowestVerifiedTotal, withPhaseOneMerchants } from '../report';
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
  const candidates = report.data ? withPhaseOneMerchants(report.data) : [];
  const lowest = lowestVerifiedTotal(candidates);

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
              {lowest === null ? t('noVerifiedTotal') : t('lowestVerified')}
            </Text>
            {lowest !== null ? (
              <Text
                style={[styles.claimTotal, { color: theme.colors.success }]}
              >
                {formatEGP(lowest, locale)}
              </Text>
            ) : null}
          </Card>

          <View style={styles.cards}>
            {candidates.map((candidate) => (
              <CandidateCard
                candidate={candidate}
                isLowest={
                  lowest !== null && candidate.breakdown.total === lowest
                }
                key={candidate.id}
              />
            ))}
          </View>
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
  claimLabel: { fontSize: 14, lineHeight: 20, fontWeight: '800' },
  claimTotal: { fontSize: 25, fontWeight: '900' },
  cards: { gap: 12 },
});

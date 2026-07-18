import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AppButton, Card, Screen } from '@/components';
import { useToast } from '@/components/Toast';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { MessageKey, useLocalization } from '@/localization';
import { ApprovalCard } from '../components/ApprovalCard';
import { RemoteBrowser } from '../components/RemoteBrowser';
import { RunTimeline } from '../components/RunTimeline';
import { LanguageToggle, SectionHeading } from '../components/ShoppingControls';
import { warningListKey } from '../report';
import {
  approveDomains,
  approveSeatHold,
  getShoppingReport,
  sendRunAction,
  shareAddressAfterExplicitConsent,
  submitClarification,
} from '../shopping.service';
import { EventEnvelope, RunStatus } from '../types';
import { RunConnectionState, useShoppingRun } from '../useShoppingRun';

const connectionKeys: Record<RunConnectionState, MessageKey> = {
  connecting: 'connectionConnecting',
  live: 'connectionLive',
  reconnecting: 'connectionReconnecting',
  polling: 'connectionPolling',
  offline: 'connectionOffline',
};

const statusKeys: Record<RunStatus, MessageKey> = {
  clarifying: 'clarifying',
  discovering: 'discovering',
  awaiting_domain_approval: 'awaitingDomainApproval',
  comparing: 'comparing',
  awaiting_address_consent: 'awaitingAddressConsent',
  awaiting_seat_hold_approval: 'awaitingSeatHoldApproval',
  coupon_testing: 'couponTesting',
  ready_for_handoff: 'readyForHandoff',
  user_takeover: 'userTakeover',
  paused: 'paused',
  completed: 'completed',
  cancelled: 'cancelled',
  failed: 'failed',
};

function latestExpiredLease(events: EventEnvelope[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === 'control.lease_expired') return event.payload.leaseId;
  }
  return undefined;
}

export function ShoppingRunScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const runId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { theme } = useTheme();
  const { showToast } = useToast();
  const { user } = useAuth();
  const addressOwnerId = user?.id ?? 'guest';
  const { t, textDirection, rowDirection } = useLocalization();
  const { snapshot, connection, error, applyRun } = useShoppingRun(runId ?? '');
  const report = useQuery({
    queryKey: ['shopping-report-live', runId],
    queryFn: () => getShoppingReport(runId ?? ''),
    enabled: Boolean(runId && snapshot),
    refetchInterval:
      snapshot &&
      !['completed', 'cancelled', 'failed'].includes(snapshot.status)
        ? 5_000
        : false,
    retry: false,
  });
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const loadErrorShown = useRef(false);

  useEffect(() => {
    if (error && !snapshot && !loadErrorShown.current) {
      loadErrorShown.current = true;
      showToast(t('runLoadFailed'), 'warning', 5000);
    } else if (!error) {
      loadErrorShown.current = false;
    }
  }, [error, showToast, snapshot, t]);

  const runAction = async (
    action: 'pause' | 'resume' | 'cancel' | 'complete',
  ) => {
    if (!runId) return;
    setBusyAction(action);
    try {
      applyRun(await sendRunAction(runId, action));
    } catch {
      showToast(t('runActionFailed'), 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const submitPendingAction = async (
    kind: string,
    task: () => Promise<
      { run: Parameters<typeof applyRun>[0] } | Parameters<typeof applyRun>[0]
    >,
  ) => {
    setBusyAction(kind);
    try {
      const result = await task();
      applyRun('run' in result ? result.run : result);
    } catch (reason) {
      const addressMissing =
        reason instanceof Error && reason.message === 'ADDRESS_PROFILE_MISSING';
      showToast(
        t(addressMissing ? 'addressMissing' : 'approvalFailed'),
        addressMissing ? 'warning' : 'error',
      );
    } finally {
      setBusyAction(null);
    }
  };

  const terminal = snapshot
    ? ['completed', 'cancelled', 'failed'].includes(snapshot.status)
    : false;
  const pendingAction = snapshot?.pendingAction;

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
            {t('runTitle')}
          </Text>
        </View>
        <LanguageToggle />
      </View>
      <Text
        style={[styles.subtitle, textDirection, { color: theme.colors.muted }]}
      >
        {t('runSubtitle')}
      </Text>

      <View style={[styles.statusRow, rowDirection]}>
        <View
          style={[
            styles.statusPill,
            {
              backgroundColor:
                connection === 'live'
                  ? theme.colors.success
                  : connection === 'offline'
                    ? theme.colors.danger
                    : theme.colors.warning,
            },
          ]}
        >
          <Text style={styles.statusPillText}>
            {t(connectionKeys[connection])}
          </Text>
        </View>
        {snapshot ? (
          <View style={[styles.runState, { borderColor: theme.colors.border }]}>
            <Text style={{ color: theme.colors.text, fontWeight: '800' }}>
              {t(statusKeys[snapshot.status])}
            </Text>
          </View>
        ) : null}
      </View>

      {snapshot ? (
        <>
          <View style={[styles.controls, rowDirection]}>
            <AppButton
              disabled={
                Boolean(busyAction) || terminal || snapshot.status === 'paused'
              }
              label={t('pause')}
              onPress={() => void runAction('pause')}
              style={styles.control}
              variant="secondary"
            />
            <AppButton
              disabled={
                Boolean(busyAction) || terminal || snapshot.status !== 'paused'
              }
              label={t('resume')}
              onPress={() => void runAction('resume')}
              style={styles.control}
              variant="secondary"
            />
            <AppButton
              disabled={Boolean(busyAction) || terminal}
              label={t('cancel')}
              onPress={() => void runAction('cancel')}
              style={styles.control}
              variant="danger"
            />
            <AppButton
              disabled={
                Boolean(busyAction) ||
                !['ready_for_handoff', 'user_takeover'].includes(
                  snapshot.status,
                )
              }
              label={t('finishSession')}
              onPress={() => void runAction('complete')}
              style={styles.control}
              variant="secondary"
            />
          </View>

          {pendingAction &&
          pendingAction.type !== 'handoff' &&
          pendingAction.type !== 'browser_takeover' ? (
            <View style={styles.section}>
              <SectionHeading title={t('approvals')} />
              <ApprovalCard
                action={pendingAction}
                busy={busyAction === pendingAction.requestId}
                onAddress={() =>
                  void submitPendingAction(pendingAction.requestId, () =>
                    shareAddressAfterExplicitConsent(
                      snapshot.id,
                      pendingAction.requestId,
                      pendingAction.type === 'address_consent'
                        ? pendingAction.merchantDomains
                        : [],
                      addressOwnerId,
                    ),
                  )
                }
                onClarification={(answers) =>
                  void submitPendingAction(pendingAction.requestId, () =>
                    submitClarification(
                      snapshot.id,
                      pendingAction.requestId,
                      answers,
                    ),
                  )
                }
                onDomains={(domains) =>
                  void submitPendingAction(pendingAction.requestId, () =>
                    approveDomains(
                      snapshot.id,
                      pendingAction.requestId,
                      domains,
                    ),
                  )
                }
                onSeatHold={() =>
                  void submitPendingAction(pendingAction.requestId, () =>
                    pendingAction.type === 'seat_hold_approval'
                      ? approveSeatHold(
                          snapshot.id,
                          pendingAction.requestId,
                          pendingAction.offerId,
                          pendingAction.merchantDomain,
                        )
                      : Promise.reject(new Error('INVALID_PENDING_ACTION')),
                  )
                }
              />
            </View>
          ) : null}

          {pendingAction?.type === 'handoff' ? (
            <Card>
              <Text
                style={[
                  styles.handoff,
                  textDirection,
                  { color: theme.colors.warning },
                ]}
              >
                {t('handoffReady')}
              </Text>
            </Card>
          ) : null}

          <RemoteBrowser
            expiredLeaseId={latestExpiredLease(snapshot.events)}
            onRunChanged={applyRun}
            runId={snapshot.id}
            status={snapshot.status}
            takeoverAction={
              pendingAction?.type === 'browser_takeover'
                ? pendingAction
                : undefined
            }
          />

          {snapshot.failure ? (
            <Card>
              <SectionHeading title={t('failure')} />
              <Text
                style={[
                  styles.listItem,
                  textDirection,
                  { color: theme.colors.danger },
                ]}
              >
                {snapshot.failure.code} · {snapshot.failure.message}
              </Text>
            </Card>
          ) : null}

          {report.data?.merchantAttempts.length ? (
            <Card>
              <SectionHeading title={t('merchantProgress')} />
              {report.data.merchantAttempts.map((attempt) => (
                <Text
                  key={attempt.id}
                  style={[
                    styles.listItem,
                    textDirection,
                    { color: theme.colors.text },
                  ]}
                >
                  • {attempt.merchantName} · {attempt.outcome}
                  {attempt.failureCode ? ` · ${attempt.failureCode}` : ''}
                </Text>
              ))}
            </Card>
          ) : null}

          {report.data?.warnings.length ? (
            <Card>
              <SectionHeading title={t('warnings')} />
              {report.data.warnings.map((warning, index) => (
                <Text
                  key={warningListKey(warning, index)}
                  style={[
                    styles.listItem,
                    textDirection,
                    { color: theme.colors.warning },
                  ]}
                >
                  • {warning.code} · {warning.message}
                </Text>
              ))}
            </Card>
          ) : null}

          {report.data?.partialFailures.length ? (
            <Card>
              <SectionHeading title={t('partialFailures')} />
              {report.data.partialFailures.map((failure) => (
                <Text
                  key={`${failure.merchantAttemptId}-${failure.code}`}
                  style={[
                    styles.listItem,
                    textDirection,
                    { color: theme.colors.warning },
                  ]}
                >
                  • {failure.code} · {failure.message}
                </Text>
              ))}
            </Card>
          ) : null}

          <Card>
            <SectionHeading title={t('timeline')} />
            <RunTimeline events={snapshot.events} />
          </Card>

          <AppButton
            label={t('openReport')}
            onPress={() =>
              router.push({
                pathname: '/run/[id]/report',
                params: { id: runId },
              })
            }
          />
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
  statusRow: { alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  statusPill: { borderRadius: 16, paddingHorizontal: 11, paddingVertical: 7 },
  statusPillText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  runState: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  controls: { flexWrap: 'wrap', gap: 8 },
  control: { minWidth: 100, flexGrow: 1 },
  section: { gap: 10 },
  listItem: { fontSize: 14, lineHeight: 21 },
  handoff: { fontSize: 15, lineHeight: 22, fontWeight: '800' },
});

import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { AppButton, Card, Screen } from '@/components';
import { useToast } from '@/components/Toast';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { MessageKey, useLocalization } from '@/localization';
import { ApprovalCard } from '../components/ApprovalCard';
import { RemoteBrowser } from '../components/RemoteBrowser';
import { RunTimeline, ScreenshotGallery } from '../components/RunTimeline';
import {
  LanguageToggle,
  SectionHeading,
} from '../components/ShoppingControls';
import {
  decideApproval,
  declineAddressShare,
  sendRunAction,
  shareAddressAfterExplicitConsent,
} from '../shopping.service';
import { RunApproval, RunStatus } from '../types';
import { RunConnectionState, useShoppingRun } from '../useShoppingRun';

const connectionKeys: Record<RunConnectionState, MessageKey> = {
  connecting: 'connectionConnecting',
  live: 'connectionLive',
  reconnecting: 'connectionReconnecting',
  polling: 'connectionPolling',
  offline: 'connectionOffline',
};

const statusKeys: Record<RunStatus, MessageKey> = {
  queued: 'queued',
  running: 'running',
  paused: 'paused',
  completed: 'completed',
  cancelled: 'cancelled',
  failed: 'failed',
};

export function ShoppingRunScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const runId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { theme } = useTheme();
  const { showToast } = useToast();
  const { user } = useAuth();
  const addressOwnerId = user?.id ?? 'guest';
  const { t, textDirection, rowDirection } = useLocalization();
  const { snapshot, connection, error, applySnapshot } = useShoppingRun(
    runId ?? '',
  );
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

  const runAction = async (action: 'pause' | 'resume' | 'cancel') => {
    if (!runId) return;
    setBusyAction(action);
    try {
      applySnapshot(await sendRunAction(runId, action));
    } catch {
      showToast(t('runActionFailed'), 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const decide = async (
    approval: RunApproval,
    decision: 'approved' | 'declined',
  ) => {
    if (!runId) return;
    setBusyAction(approval.id);
    try {
      if (approval.type === 'address_share') {
        const next =
          decision === 'approved'
            ? await shareAddressAfterExplicitConsent(
                runId,
                approval.id,
                approval.merchant.id,
                addressOwnerId,
                true,
              )
            : await declineAddressShare(
                runId,
                approval.id,
                approval.merchant.id,
              );
        applySnapshot(next);
      } else {
        applySnapshot(
          await decideApproval(runId, approval.id, approval.type, decision),
        );
      }
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

  const pendingApprovals =
    snapshot?.approvals.filter((item) => item.status === 'pending') ?? [];
  const terminal = snapshot
    ? ['completed', 'cancelled', 'failed'].includes(snapshot.status)
    : false;

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
          </View>
          {pendingApprovals.length > 0 ? (
            <View style={styles.section}>
              <SectionHeading title={t('approvals')} />
              {pendingApprovals.map((approval) => (
                <ApprovalCard
                  approval={approval}
                  busy={busyAction === approval.id}
                  key={approval.id}
                  onDecision={(decision) => void decide(approval, decision)}
                />
              ))}
            </View>
          ) : null}

          <RemoteBrowser runId={runId} viewerUrl={snapshot.remoteViewerUrl} />

          {snapshot.warnings.length > 0 ? (
            <Card>
              <SectionHeading title={t('warnings')} />
              {snapshot.warnings.map((warning, index) => (
                <Text
                  key={`${index}-${warning}`}
                  style={[
                    styles.listItem,
                    textDirection,
                    { color: theme.colors.warning },
                  ]}
                >
                  • {warning}
                </Text>
              ))}
            </Card>
          ) : null}

          {snapshot.partialResults.length > 0 ? (
            <Card>
              <SectionHeading title={t('partialResults')} />
              {snapshot.partialResults.map((result, index) => (
                <Text
                  key={`${index}-${result}`}
                  style={[
                    styles.listItem,
                    textDirection,
                    { color: theme.colors.text },
                  ]}
                >
                  • {result}
                </Text>
              ))}
            </Card>
          ) : null}

          <Card>
            <SectionHeading title={t('timeline')} />
            <RunTimeline events={snapshot.events} />
          </Card>

          {snapshot.screenshots.length > 0 ? (
            <View style={styles.section}>
              <SectionHeading title={t('screenshots')} />
              <ScreenshotGallery screenshots={snapshot.screenshots} />
            </View>
          ) : null}

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
});

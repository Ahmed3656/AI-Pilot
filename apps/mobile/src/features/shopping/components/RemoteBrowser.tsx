import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppButton, Card } from '@/components';
import { useToast } from '@/components/Toast';
import { useTheme } from '@/contexts/ThemeContext';
import { useLocalization } from '@/localization';
import {
  claimControl,
  createViewerToken,
  releaseControl,
  renewControl,
} from '../shopping.service';
import {
  ControlLease,
  RunResource,
  RunStatus,
  ViewerTokenResponse,
} from '../types';
import { SectionHeading } from './ShoppingControls';
import { BrowserViewer } from './BrowserViewer';

function noVncUrl(uri: string, viewOnly: boolean): string {
  const url = new URL(uri);
  url.searchParams.set('autoconnect', '1');
  url.searchParams.set('resize', 'scale');
  url.searchParams.set('view_only', viewOnly ? '1' : '0');
  return url.toString();
}

const TERMINAL_STATUSES: RunStatus[] = ['completed', 'cancelled', 'failed'];
const TAKEOVER_STATUSES: RunStatus[] = ['ready_for_handoff', 'paused'];

export function RemoteBrowser({
  runId,
  status,
  expiredLeaseId,
  onRunChanged,
}: {
  runId: string;
  status: RunStatus;
  expiredLeaseId?: string;
  onRunChanged: (run: RunResource) => void;
}) {
  const { theme } = useTheme();
  const { showToast } = useToast();
  const { t, textDirection } = useLocalization();
  const [viewer, setViewer] = useState<ViewerTokenResponse | null>(null);
  const [lease, setLease] = useState<ControlLease | null>(null);
  const [busy, setBusy] = useState(false);
  const leaseRef = useRef<ControlLease | null>(null);
  leaseRef.current = lease;
  const hasControl = lease?.status === 'active' && viewer?.mode === 'control';

  const loadViewOnly = useCallback(async () => {
    if (TERMINAL_STATUSES.includes(status)) {
      setViewer(null);
      return;
    }
    const next = await createViewerToken(runId, 'view');
    setViewer(next);
  }, [runId, status]);

  const enterSafeState = useCallback(
    (notify: boolean) => {
      setLease(null);
      setViewer(null);
      if (notify) showToast(t('controlLeaseExpired'), 'warning', 5000);
      void loadViewOnly().catch(() => undefined);
    },
    [loadViewOnly, showToast, t],
  );

  useEffect(() => {
    if (!viewer && !TERMINAL_STATUSES.includes(status)) {
      void loadViewOnly().catch(() =>
        showToast(t('viewerLoadFailed'), 'warning'),
      );
    }
  }, [loadViewOnly, showToast, status, t, viewer]);

  useEffect(() => {
    if (lease && status !== 'user_takeover') enterSafeState(false);
  }, [enterSafeState, lease, status]);

  useEffect(() => {
    if (lease && expiredLeaseId === lease.id) enterSafeState(true);
  }, [enterSafeState, expiredLeaseId, lease]);

  useEffect(() => {
    if (!lease || lease.status !== 'active') return;
    const expiresIn = Math.min(
      2_147_483_647,
      Math.max(0, new Date(lease.expiresAt).getTime() - Date.now()),
    );
    const expiryTimer = setTimeout(() => enterSafeState(true), expiresIn);
    const renewalTimer = setInterval(() => {
      void renewControl(runId, lease.id)
        .then(setLease)
        .catch(() => enterSafeState(true));
    }, 30_000);
    return () => {
      clearTimeout(expiryTimer);
      clearInterval(renewalTimer);
    };
  }, [enterSafeState, lease, runId]);

  useEffect(() => {
    return () => {
      const activeLease = leaseRef.current;
      if (activeLease?.status === 'active') {
        void releaseControl(runId, activeLease.id).catch(() => undefined);
      }
    };
  }, [runId]);

  const takeOver = async () => {
    setBusy(true);
    let claimedLease: ControlLease | null = null;
    try {
      const claim = await claimControl(runId);
      claimedLease = claim.lease;
      onRunChanged(claim.run);
      const controlViewer = await createViewerToken(
        runId,
        'control',
        claim.lease.id,
      );
      setLease(claim.lease);
      setViewer(controlViewer);
    } catch {
      if (claimedLease) {
        void releaseControl(runId, claimedLease.id).catch(() => undefined);
      }
      enterSafeState(false);
      showToast(t('controlFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const release = async () => {
    if (!lease) return;
    setBusy(true);
    try {
      const released = await releaseControl(runId, lease.id);
      onRunChanged(released.run);
      setLease(null);
      setViewer(null);
      await loadViewOnly();
    } catch {
      enterSafeState(false);
      showToast(t('releaseFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const activeUrl = useMemo(
    () => (viewer ? noVncUrl(viewer.viewerUrl, !hasControl) : null),
    [hasControl, viewer],
  );
  const viewerOrigin = useMemo(
    () => (viewer ? new URL(viewer.viewerUrl).origin : null),
    [viewer],
  );

  return (
    <Card>
      <SectionHeading
        subtitle={t('remoteViewerSubtitle')}
        title={t('remoteViewer')}
      />
      <View
        style={[
          styles.mode,
          {
            backgroundColor: hasControl
              ? theme.colors.warningSurface
              : theme.colors.background,
          },
        ]}
      >
        <Text
          style={[
            styles.modeText,
            textDirection,
            { color: hasControl ? theme.colors.warning : theme.colors.success },
          ]}
        >
          {t(hasControl ? 'controlActive' : 'viewOnly')}
        </Text>
      </View>
      {activeUrl && viewer && viewerOrigin ? (
        <BrowserViewer
          borderColor={theme.colors.border}
          interactive={hasControl}
          token={`${viewer.tokenType} ${viewer.token}`}
          uri={activeUrl}
          viewerOrigin={viewerOrigin}
        />
      ) : (
        <View
          style={[
            styles.placeholder,
            { backgroundColor: theme.colors.background },
          ]}
        >
          <Text
            style={[
              styles.placeholderText,
              textDirection,
              { color: theme.colors.muted },
            ]}
          >
            {t('viewerUnavailable')}
          </Text>
        </View>
      )}
      <AppButton
        disabled={
          busy ||
          (hasControl ? false : !TAKEOVER_STATUSES.includes(status)) ||
          !viewer
        }
        label={
          busy ? t('takingOver') : t(hasControl ? 'releaseControl' : 'takeOver')
        }
        onPress={() => void (hasControl ? release() : takeOver())}
        variant={hasControl ? 'secondary' : 'primary'}
      />
      <View
        style={[
          styles.paymentWarning,
          { backgroundColor: theme.colors.warningSurface },
        ]}
      >
        <Text
          style={[
            styles.warningTitle,
            textDirection,
            { color: theme.colors.warning },
          ]}
        >
          {t('paymentWarningTitle')}
        </Text>
        <Text
          style={[
            styles.warningBody,
            textDirection,
            { color: theme.colors.text },
          ]}
        >
          {t('paymentWarning')}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  mode: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  modeText: { fontSize: 13, fontWeight: '900' },
  placeholder: {
    minHeight: 160,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  placeholderText: { fontSize: 14, lineHeight: 20 },
  paymentWarning: { borderRadius: 12, padding: 14, gap: 5 },
  warningTitle: { fontSize: 16, fontWeight: '900' },
  warningBody: { fontSize: 14, lineHeight: 21, fontWeight: '600' },
});

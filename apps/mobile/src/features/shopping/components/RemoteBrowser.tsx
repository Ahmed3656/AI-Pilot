import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { AppButton, Card } from '@/components';
import { useToast } from '@/components/Toast';
import { useTheme } from '@/contexts/ThemeContext';
import { useLocalization } from '@/localization';
import { releaseControlToken, requestControlToken } from '../shopping.service';
import { SectionHeading } from './ShoppingControls';

function noVncUrl(uri: string, viewOnly: boolean): string {
  const setParam = (value: string, key: string, next: string) => {
    const pattern = new RegExp(`([?&])${key}=[^&]*`);
    if (pattern.test(value)) return value.replace(pattern, `$1${key}=${next}`);
    return `${value}${value.includes('?') ? '&' : '?'}${key}=${next}`;
  };
  return [
    ['autoconnect', '1'],
    ['resize', 'scale'],
    ['view_only', viewOnly ? '1' : '0'],
  ].reduce((value, [key, next]) => setParam(value, key, next), uri);
}

export function RemoteBrowser({
  runId,
  viewerUrl,
}: {
  runId: string;
  viewerUrl?: string;
}) {
  const { theme } = useTheme();
  const { showToast } = useToast();
  const { t, textDirection } = useLocalization();
  const [controlUrl, setControlUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasControl = controlUrl !== null;
  const controlRef = useRef(false);
  controlRef.current = hasControl;
  const activeUrl = useMemo(() => {
    const source = controlUrl ?? viewerUrl;
    return source ? noVncUrl(source, !hasControl) : null;
  }, [controlUrl, hasControl, viewerUrl]);

  useEffect(() => {
    return () => {
      if (controlRef.current)
        void releaseControlToken(runId).catch(() => undefined);
    };
  }, [runId]);

  const takeOver = async () => {
    setBusy(true);
    try {
      const control = await requestControlToken(runId);
      setControlUrl(control.viewerUrl);
    } catch {
      showToast(t('controlFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const release = async () => {
    setBusy(true);
    try {
      await releaseControlToken(runId);
      setControlUrl(null);
    } catch {
      showToast(t('releaseFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

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
      {activeUrl && Platform.OS !== 'web' ? (
        <View
          pointerEvents={hasControl ? 'auto' : 'none'}
          style={[styles.viewerFrame, { borderColor: theme.colors.border }]}
        >
          <WebView
            allowsInlineMediaPlayback
            incognito
            javaScriptEnabled
            originWhitelist={['https://*', 'http://*']}
            source={{ uri: activeUrl }}
            style={styles.viewer}
          />
        </View>
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
        disabled={busy || !activeUrl}
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
  viewerFrame: {
    height: 380,
    overflow: 'hidden',
    borderWidth: 1,
    borderRadius: 12,
  },
  viewer: { flex: 1, backgroundColor: '#101828' },
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

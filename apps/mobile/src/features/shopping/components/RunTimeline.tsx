import { Image, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useLocalization } from '@/localization';
import { EvidenceReference, EventEnvelope } from '../types';

function eventMessage(event: EventEnvelope): string {
  switch (event.type) {
    case 'run.status_changed':
      return `${event.payload.from} → ${event.payload.to}${event.payload.reasonCode ? ` · ${event.payload.reasonCode}` : ''}`;
    case 'merchant.attempt_started':
      return event.payload.merchantDomain;
    case 'merchant.attempt_completed':
      return `${event.payload.outcome}${event.payload.failureCode ? ` · ${event.payload.failureCode}` : ''}`;
    case 'offer.recorded':
      return `${event.payload.validity} · ${event.payload.offerId}`;
    case 'coupon.attempted':
      return `${event.payload.status}${event.payload.rejectionReason ? ` · ${event.payload.rejectionReason}` : ''}`;
    case 'evidence.captured':
      return `${event.payload.kind} · ${event.payload.evidenceId}`;
    case 'run.warning':
      return `${event.payload.code} · ${event.payload.message}`;
    case 'report.updated':
      return `valid ${event.payload.validOfferCount} · incomplete ${event.payload.incompleteOfferCount} · excluded ${event.payload.excludedOfferCount}`;
    case 'control.lease_expired':
      return `${event.payload.leaseId} · recovery ${event.payload.recovery}`;
    case 'run.failed':
      return event.payload.failureCode;
    default:
      return event.type;
  }
}

function eventColor(
  event: EventEnvelope,
  colors: {
    primary: string;
    success: string;
    warning: string;
    danger: string;
  },
) {
  if (event.type === 'run.failed') return colors.danger;
  if (event.type === 'run.warning') return colors.warning;
  if (event.type === 'merchant.attempt_completed') {
    return event.payload.outcome === 'succeeded'
      ? colors.success
      : colors.warning;
  }
  if (event.type === 'coupon.attempted') {
    return event.payload.status === 'verified'
      ? colors.success
      : event.payload.status === 'rejected'
        ? colors.danger
        : colors.warning;
  }
  return colors.primary;
}

export function RunTimeline({ events }: { events: EventEnvelope[] }) {
  const { theme } = useTheme();
  const { t, textDirection, rowDirection, locale } = useLocalization();
  if (events.length === 0) {
    return (
      <Text style={[textDirection, { color: theme.colors.muted }]}>
        {t('noEvents')}
      </Text>
    );
  }
  return (
    <View style={styles.timeline}>
      {events.map((event) => (
        <View key={event.id} style={[styles.event, rowDirection]}>
          <View
            style={[
              styles.dot,
              {
                backgroundColor: eventColor(event, {
                  primary: theme.colors.primary,
                  success: theme.colors.success,
                  warning: theme.colors.warning,
                  danger: theme.colors.danger,
                }),
              },
            ]}
          />
          <View style={styles.eventBody}>
            <View style={[styles.eventTop, rowDirection]}>
              <Text
                style={[
                  styles.eventTitle,
                  textDirection,
                  { color: theme.colors.text },
                ]}
              >
                {event.type}
              </Text>
              <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                {new Intl.DateTimeFormat(locale, {
                  timeZone: 'Africa/Cairo',
                  hour: 'numeric',
                  minute: '2-digit',
                }).format(new Date(event.timestamp))}
              </Text>
            </View>
            <Text
              style={[
                styles.message,
                textDirection,
                { color: theme.colors.muted },
              ]}
            >
              {eventMessage(event)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export function EvidenceGallery({
  evidence,
}: {
  evidence: EvidenceReference[];
}) {
  const { theme } = useTheme();
  const { accessToken } = useAuth();
  const { t, textDirection, locale } = useLocalization();
  return (
    <View style={styles.gallery}>
      {evidence.map((item) => (
        <Card key={item.id}>
          {item.kind === 'screenshot' ? (
            <Image
              accessibilityLabel={`${t('evidence')} ${item.id}`}
              resizeMode="cover"
              source={{
                uri: item.uri,
                ...(accessToken
                  ? { headers: { Authorization: `Bearer ${accessToken}` } }
                  : {}),
              }}
              style={styles.screenshot}
            />
          ) : null}
          <Text
            style={[
              styles.merchant,
              textDirection,
              { color: theme.colors.text },
            ]}
          >
            {item.kind} · {item.id}
          </Text>
          <Text
            style={[textDirection, { color: theme.colors.muted, fontSize: 12 }]}
          >
            {new Intl.DateTimeFormat(locale, {
              timeZone: 'Africa/Cairo',
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(item.capturedAt))}{' '}
            · {t('redactedEvidence')}
          </Text>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  timeline: { gap: 14 },
  event: { alignItems: 'flex-start', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  eventBody: { flex: 1, gap: 3 },
  eventTop: { justifyContent: 'space-between', gap: 8 },
  eventTitle: { flex: 1, fontSize: 14, fontWeight: '800' },
  message: { fontSize: 13, lineHeight: 19 },
  gallery: { gap: 10 },
  screenshot: { width: '100%', height: 190, borderRadius: 10 },
  merchant: { fontSize: 14, fontWeight: '800' },
});

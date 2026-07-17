import { Image, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components';
import { useTheme } from '@/contexts/ThemeContext';
import { useLocalization } from '@/localization';
import { RunEvent, RunScreenshot } from '../types';

function CouponStatus({ status }: Pick<RunEvent, 'status'>) {
  const { t } = useLocalization();
  const { theme } = useTheme();
  const label =
    status === 'applied'
      ? t('couponApplied')
      : status === 'rejected'
        ? t('couponRejected')
        : t('couponTrying');
  const color =
    status === 'applied'
      ? theme.colors.success
      : status === 'rejected'
        ? theme.colors.danger
        : theme.colors.warning;
  return <Text style={[styles.coupon, { color }]}>{label}</Text>;
}

export function RunTimeline({ events }: { events: RunEvent[] }) {
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
      {events.map((event) => {
        const dotColor =
          event.severity === 'error'
            ? theme.colors.danger
            : event.severity === 'warning'
              ? theme.colors.warning
              : event.severity === 'success'
                ? theme.colors.success
                : theme.colors.primary;
        return (
          <View key={event.id} style={[styles.event, rowDirection]}>
            <View style={[styles.dot, { backgroundColor: dotColor }]} />
            <View style={styles.eventBody}>
              <View style={[styles.eventTop, rowDirection]}>
                <Text
                  style={[
                    styles.eventTitle,
                    textDirection,
                    { color: theme.colors.text },
                  ]}
                >
                  {event.type === 'coupon' ? t('couponAttempt') : event.title}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                  {new Intl.DateTimeFormat(
                    locale === 'ar' ? 'ar-EG' : 'en-EG',
                    {
                      hour: 'numeric',
                      minute: '2-digit',
                    },
                  ).format(new Date(event.createdAt))}
                </Text>
              </View>
              {event.type === 'coupon' ? (
                <CouponStatus status={event.status} />
              ) : null}
              {event.message ? (
                <Text
                  style={[
                    styles.message,
                    textDirection,
                    { color: theme.colors.muted },
                  ]}
                >
                  {event.message}
                </Text>
              ) : null}
              {event.imageUrl ? (
                <Image
                  accessibilityLabel={event.title}
                  resizeMode="cover"
                  source={{ uri: event.imageUrl }}
                  style={styles.eventImage}
                />
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function ScreenshotGallery({
  screenshots,
}: {
  screenshots: RunScreenshot[];
}) {
  const { theme } = useTheme();
  const { textDirection, locale } = useLocalization();
  return (
    <View style={styles.gallery}>
      {screenshots.map((screenshot) => (
        <Card key={screenshot.id}>
          <Image
            accessibilityLabel={screenshot.merchantName}
            resizeMode="cover"
            source={{ uri: screenshot.imageUrl }}
            style={styles.screenshot}
          />
          <Text
            style={[
              styles.merchant,
              textDirection,
              { color: theme.colors.text },
            ]}
          >
            {screenshot.merchantName}
          </Text>
          <Text
            style={[textDirection, { color: theme.colors.muted, fontSize: 12 }]}
          >
            {new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', {
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(screenshot.capturedAt))}
          </Text>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  timeline: { gap: 16 },
  event: { alignItems: 'flex-start', gap: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  eventBody: { flex: 1, gap: 5 },
  eventTop: { justifyContent: 'space-between', gap: 12 },
  eventTitle: { flex: 1, fontSize: 15, fontWeight: '800' },
  message: { fontSize: 14, lineHeight: 20 },
  coupon: { fontSize: 13, fontWeight: '900' },
  eventImage: {
    width: '100%',
    aspectRatio: 1.7,
    borderRadius: 10,
    marginTop: 4,
  },
  gallery: { gap: 10 },
  screenshot: { width: '100%', aspectRatio: 1.7, borderRadius: 10 },
  merchant: { fontSize: 14, fontWeight: '800' },
});

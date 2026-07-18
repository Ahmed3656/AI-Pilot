import { Image, StyleSheet } from 'react-native';
import { useAuth } from '@/contexts/AuthContext';

export function EvidenceScreenshot({
  accessibilityLabel,
  expanded = false,
  uri,
}: {
  accessibilityLabel: string;
  expanded?: boolean;
  uri: string;
}) {
  const { accessToken } = useAuth();
  return (
    <Image
      accessibilityLabel={accessibilityLabel}
      resizeMode={expanded ? 'contain' : 'cover'}
      source={{
        uri,
        ...(accessToken
          ? { headers: { Authorization: `Bearer ${accessToken}` } }
          : {}),
      }}
      style={[styles.screenshot, expanded && styles.expanded]}
      testID={expanded ? 'evidence-screenshot-full' : undefined}
    />
  );
}

const styles = StyleSheet.create({
  screenshot: { width: '100%', height: 190, borderRadius: 10 },
  expanded: { flex: 1, height: undefined, borderRadius: 0 },
});

import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { apiClient } from '@/api/client';
import { useTheme } from '@/contexts/ThemeContext';

export function EvidenceScreenshot({
  accessibilityLabel,
  expanded = false,
  uri,
}: {
  accessibilityLabel: string;
  expanded?: boolean;
  uri: string;
}) {
  const { theme } = useTheme();
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    void apiClient
      .get<Blob>(uri, { responseType: 'blob' })
      .then(({ data }) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(data);
        setSource(objectUrl);
      })
      .catch(() => {
        if (active) setSource(null);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [uri]);

  if (!source) {
    return (
      <View
        accessibilityLabel={accessibilityLabel}
        style={[
          styles.screenshot,
          expanded && styles.expanded,
          { backgroundColor: theme.colors.background },
        ]}
        testID={expanded ? 'evidence-screenshot-full' : undefined}
      />
    );
  }
  return (
    <Image
      accessibilityLabel={accessibilityLabel}
      resizeMode={expanded ? 'contain' : 'cover'}
      source={{ uri: source }}
      style={[styles.screenshot, expanded && styles.expanded]}
      testID={expanded ? 'evidence-screenshot-full' : undefined}
    />
  );
}

const styles = StyleSheet.create({
  screenshot: { width: '100%', height: 190, borderRadius: 10 },
  expanded: { flex: 1, height: undefined, borderRadius: 0 },
});

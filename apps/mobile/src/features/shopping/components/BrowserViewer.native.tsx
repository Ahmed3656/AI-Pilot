import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

interface BrowserViewerProps {
  borderColor: string;
  interactive: boolean;
  token: string;
  uri: string;
  viewerOrigin: string;
}

export function BrowserViewer({
  borderColor,
  interactive,
  token,
  uri,
  viewerOrigin,
}: BrowserViewerProps) {
  return (
    <View
      pointerEvents={interactive ? 'auto' : 'none'}
      style={[styles.frame, { borderColor }]}
    >
      <WebView
        allowsInlineMediaPlayback
        javaScriptEnabled
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={(request) => {
          try {
            return new URL(request.url).origin === viewerOrigin;
          } catch {
            return false;
          }
        }}
        originWhitelist={[`${viewerOrigin}/*`]}
        source={{
          uri,
          headers: { Authorization: token },
        }}
        style={styles.viewer}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    height: 380,
    overflow: 'hidden',
    borderWidth: 1,
    borderRadius: 12,
  },
  viewer: { flex: 1, backgroundColor: '#101828' },
});

import { Component, ErrorInfo, PropsWithChildren, ReactNode } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // TODO(observability): send sanitized mobile errors to the selected provider.
    console.error('Unhandled mobile error', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>
          The app hit an unexpected error. Please try again.
        </Text>
        <Button
          title="Try again"
          onPress={() => this.setState({ error: null })}
        />
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  title: { fontSize: 22, fontWeight: '700' },
  body: { textAlign: 'center', color: '#667085' },
});

/**
 * CompartmentErrorBoundary — catches render crashes in backpack compartment panels.
 * Shows a friendly error message instead of white-screening the whole app.
 */
import React, { Component, type ReactNode } from 'react';
import { Platform, View, Text, Pressable, StyleSheet } from 'react-native';

interface Props {
  name: string;
  color: string;
  onBack: () => void;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  retryKey: number;
  error: Error | null;
}

export default class CompartmentErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, retryKey: 0, error: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[Backpack] ${this.props.name} crashed:`, error, info.componentStack);
  }

  componentDidUpdate(previousProps: Props) {
    if (previousProps.name !== this.props.name && this.state.hasError) {
      this.setState(state => ({ hasError: false, retryKey: state.retryKey + 1, error: null }));
    }
  }

  private isChunkLoadFailure(): boolean {
    const message = this.state.error?.message || '';
    return /chunkloaderror|loading chunk|failed to fetch dynamically imported module|importing a module script failed/i.test(message);
  }

  private recover = () => {
    if (this.isChunkLoadFailure() && Platform.OS === 'web') {
      globalThis.location?.reload();
      return;
    }
    this.setState(state => ({ hasError: false, retryKey: state.retryKey + 1, error: null }));
  };

  render() {
    if (this.state.hasError) {
      const chunkLoadFailure = this.isChunkLoadFailure();
      const recoveryLabel = chunkLoadFailure && Platform.OS === 'web' ? 'Reload app' : 'Retry';
      return (
        <View style={styles.container} accessibilityRole="alert">
          <Text style={[styles.icon, { color: this.props.color }]}>!</Text>
          <Text style={styles.title}>{this.props.name} could not open</Text>
          <Text style={styles.message}>This workspace encountered an unexpected loading problem.</Text>
          <Text style={styles.hint}>
            {chunkLoadFailure && Platform.OS === 'web'
              ? 'The workspace bundle could not be downloaded. Reload the app to request a fresh copy.'
              : 'Retry the workspace once. If it still fails, return to the Backpack and reopen it.'}
          </Text>
          <View style={styles.buttons}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${recoveryLabel} for ${this.props.name}`}
              onPress={this.recover}
              style={({ hovered, pressed, focused }: any) => [
                styles.btn,
                { borderColor: this.props.color + '70' },
                hovered && Platform.OS === 'web' ? styles.btnHover : null,
                focused ? styles.btnFocused : null,
                pressed ? styles.btnPressed : null,
              ]}
            >
              <Text style={[styles.btnText, { color: this.props.color }]}>{recoveryLabel}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to Backpack"
              onPress={this.props.onBack}
              style={({ hovered, pressed, focused }: any) => [
                styles.btn,
                { borderColor: '#ffffff30' },
                hovered && Platform.OS === 'web' ? styles.btnHover : null,
                focused ? styles.btnFocused : null,
                pressed ? styles.btnPressed : null,
              ]}
            >
              <Text style={styles.btnText}>Back</Text>
            </Pressable>
          </View>
        </View>
      );
    }
    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  icon: {
    fontSize: 48,
    fontFamily: 'monospace',
    fontWeight: '700',
    marginBottom: 12,
  },
  title: {
    color: '#e2e8f0',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  message: {
    color: '#cbd5e1',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 12,
    maxWidth: 400,
  },
  hint: {
    color: '#64748b',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 20,
    maxWidth: 400,
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
  },
  btn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: '#111827',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  btnHover: { backgroundColor: '#1a2331' },
  btnFocused: {
    ...Platform.select({ web: { outlineStyle: 'none', boxShadow: '0 0 0 3px rgba(167,139,250,0.4)' } as any, default: {} }),
  },
  btnPressed: { opacity: 0.76 },
  btnText: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '600',
  },
});

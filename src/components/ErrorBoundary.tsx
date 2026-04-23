import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Platform } from 'react-native';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  scope?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
  showDetails: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, showDetails: false };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const scope = this.props.scope ? `[${this.props.scope}] ` : '';
    console.error(`ErrorBoundary ${scope}caught:`, error, errorInfo);
    this.setState({ error, errorInfo });
    if (Platform.OS === 'web') {
      try {
        (window as any).__uc_last_boundary_error = {
          scope: this.props.scope || null,
          message: error?.message,
          stack: error?.stack,
          componentStack: errorInfo?.componentStack,
          at: new Date().toISOString(),
        };
      } catch {}
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined, showDetails: false });
  };

  toggleDetails = () => {
    this.setState({ showDetails: !this.state.showDetails });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    const scopeLabel = this.props.scope ? `in ${this.props.scope}` : 'in this surface';

    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <View style={styles.dangerDot} />
          <Text style={styles.title}>Something went wrong {scopeLabel}</Text>
          <Text style={styles.subtitle}>
            The rest of the app is still running. You can retry, or open details to copy the stack trace.
          </Text>

          <View style={styles.row}>
            <Pressable onPress={this.handleReset} style={({ hovered, pressed }: any) => [
              styles.primaryBtn,
              hovered && styles.primaryBtnHover,
              pressed && styles.primaryBtnPressed,
            ]}>
              <Text style={styles.primaryBtnText}>Retry</Text>
            </Pressable>
            {this.state.error && (
              <Pressable onPress={this.toggleDetails} style={({ hovered }: any) => [
                styles.secondaryBtn,
                hovered && styles.secondaryBtnHover,
              ]}>
                <Text style={styles.secondaryBtnText}>
                  {this.state.showDetails ? 'Hide details' : 'Show details'}
                </Text>
              </Pressable>
            )}
          </View>

          {this.state.showDetails && this.state.error && (
            <ScrollView style={styles.debugBox} contentContainerStyle={{ padding: 12 }}>
              <Text style={styles.debugLabel}>Error</Text>
              <Text style={styles.debugText} selectable>
                {this.state.error.toString()}
              </Text>
              {this.state.error.stack && (
                <>
                  <Text style={[styles.debugLabel, { marginTop: 12 }]}>Stack</Text>
                  <Text style={styles.debugText} selectable>
                    {this.state.error.stack}
                  </Text>
                </>
              )}
              {this.state.errorInfo?.componentStack && (
                <>
                  <Text style={[styles.debugLabel, { marginTop: 12 }]}>Component stack</Text>
                  <Text style={styles.debugText} selectable>
                    {this.state.errorInfo.componentStack}
                  </Text>
                </>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#161b22',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#30363d',
    padding: 24,
    maxWidth: 520,
    width: '100%',
  },
  dangerDot: {
    width: 10,
    height: 10,
    borderRadius: 9999,
    backgroundColor: '#f85149',
    marginBottom: 14,
  },
  title: {
    color: '#e6edf3',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 6,
  },
  subtitle: {
    color: '#8b949e',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 18,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  primaryBtn: {
    backgroundColor: '#6366f1',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  primaryBtnHover: {
    backgroundColor: '#818cf8',
  },
  primaryBtnPressed: {
    backgroundColor: '#4f46e5',
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryBtn: {
    backgroundColor: '#21262d',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363d',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  secondaryBtnHover: {
    backgroundColor: '#1c2128',
    borderColor: '#484f58',
  },
  secondaryBtnText: {
    color: '#e6edf3',
    fontSize: 14,
    fontWeight: '500',
  },
  debugBox: {
    marginTop: 14,
    backgroundColor: '#010409',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363d',
    maxHeight: 240,
  },
  debugLabel: {
    color: '#8b949e',
    fontSize: 11,
    fontWeight: '600',
    fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', default: 'monospace' }) as string,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  debugText: {
    color: '#c9d1d9',
    fontSize: 11,
    fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', default: 'monospace' }) as string,
    lineHeight: 16,
  },
});

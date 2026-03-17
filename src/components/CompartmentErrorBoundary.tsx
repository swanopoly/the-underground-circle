/**
 * CompartmentErrorBoundary — catches render crashes in backpack compartment panels.
 * Shows a friendly error message instead of white-screening the whole app.
 */
import React, { Component, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

interface Props {
  name: string;
  color: string;
  onBack: () => void;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: string;
}

export default class CompartmentErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message || 'Unknown error' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[Backpack] ${this.props.name} crashed:`, error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={[styles.icon, { color: this.props.color }]}>!</Text>
          <Text style={styles.title}>{this.props.name} Error</Text>
          <Text style={styles.message}>{this.state.error}</Text>
          <Text style={styles.hint}>
            This compartment encountered a problem loading. Try again or check the console for details.
          </Text>
          <View style={styles.buttons}>
            <Pressable
              onPress={() => this.setState({ hasError: false, error: '' })}
              style={[styles.btn, { borderColor: this.props.color + '40' }]}
            >
              <Text style={[styles.btnText, { color: this.props.color }]}>Retry</Text>
            </Pressable>
            <Pressable
              onPress={this.props.onBack}
              style={[styles.btn, { borderColor: '#ffffff20' }]}
            >
              <Text style={styles.btnText}>Back</Text>
            </Pressable>
          </View>
        </View>
      );
    }
    return this.props.children;
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
    fontFamily: 'monospace',
    marginBottom: 8,
  },
  message: {
    color: '#ef4444',
    fontSize: 13,
    fontFamily: 'monospace',
    textAlign: 'center',
    marginBottom: 12,
    maxWidth: 400,
  },
  hint: {
    color: '#64748b',
    fontSize: 12,
    fontFamily: 'monospace',
    textAlign: 'center',
    marginBottom: 20,
    maxWidth: 400,
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
  },
  btn: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderRadius: 4,
  },
  btnText: {
    color: '#e2e8f0',
    fontSize: 13,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
});

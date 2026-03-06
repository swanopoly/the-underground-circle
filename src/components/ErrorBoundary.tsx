import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
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
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined, showDetails: false });
  };

  toggleDetails = () => {
    this.setState({ showDetails: !this.state.showDetails });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <View style={styles.container}>
          <View style={styles.errorCard}>
            <View style={styles.iconContainer}>
              <Text style={styles.icon}>⚠️</Text>
            </View>
            <Text style={styles.title}>Something went wrong</Text>
            <Text style={styles.subtitle}>
              An unexpected error occurred. The app has been recovered.
            </Text>
            {this.state.error && (
              <TouchableOpacity 
                style={styles.detailsToggle} 
                onPress={this.toggleDetails}
              >
                <Text style={styles.detailsToggleText}>
                  {this.state.showDetails ? '▼' : '▶'} Error Details
                </Text>
              </TouchableOpacity>
            )}
            {this.state.showDetails && this.state.error && (
              <View style={styles.debugContainer}>
                <Text style={styles.debugTitle}>Error Stack:</Text>
                <Text style={styles.debugText}>
                  {this.state.error.toString()}
                  {'\n\n'}
                  {this.state.error.stack}
                </Text>
                {this.state.errorInfo && (
                  <>
                    <Text style={styles.debugTitle}>Component Stack:</Text>
                    <Text style={styles.debugText}>
                      {this.state.errorInfo.componentStack}
                    </Text>
                  </>
                )}
              </View>
            )}
            <TouchableOpacity style={styles.button} onPress={this.handleReset}>
              <Text style={styles.buttonText}>TRY AGAIN</Text>
            </TouchableOpacity>
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
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  errorCard: {
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 32,
    maxWidth: 400,
    width: '100%',
    borderWidth: 1,
    borderColor: '#222',
    alignItems: 'center',
  },
  iconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#2a1a15',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  icon: {
    fontSize: 28,
  },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  detailsToggle: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 16,
    backgroundColor: '#1a1a1a',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#333',
  },
  detailsToggleText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  debugContainer: {
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    padding: 12,
    width: '100%',
    marginBottom: 24,
    maxHeight: 200,
  },
  debugTitle: {
    color: '#ff6666',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
    marginTop: 8,
    fontFamily: 'monospace',
  },
  debugText: {
    color: '#999',
    fontSize: 10,
    fontFamily: 'monospace',
    lineHeight: 14,
  },
  button: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  buttonText: {
    color: '#0a0a0a',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
});
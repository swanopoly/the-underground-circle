/**
 * Toast — lightweight notification system
 * Shows brief messages that slide in and auto-dismiss.
 *
 * Usage:
 *   import { useToast, ToastProvider } from './Toast';
 *   // Wrap your app: <ToastProvider>...</ToastProvider>
 *   // In components: const { show } = useToast();
 *   //   show('Task completed!', 'success');
 */
import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Platform, Animated } from 'react-native';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  anim: Animated.Value;
}

interface ToastContextValue {
  show: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ show: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const TYPE_COLORS: Record<ToastType, { bg: string; border: string; text: string; icon: string }> = {
  success: { bg: '#22c55e10', border: '#22c55e40', text: '#22c55e', icon: '+' },
  error:   { bg: '#ef444410', border: '#ef444440', text: '#ef4444', icon: '!' },
  info:    { bg: '#6366f110', border: '#6366f140', text: '#6366f1', icon: '>' },
  warning: { bg: '#f59e0b10', border: '#f59e0b40', text: '#f59e0b', icon: '~' },
};

const DISMISS_MS = 3500;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counterRef = useRef(0);

  const show = useCallback((message: string, type: ToastType = 'info') => {
    const id = `toast-${++counterRef.current}`;
    const anim = new Animated.Value(0);
    const item: ToastItem = { id, message, type, anim };

    setToasts(prev => [...prev.slice(-4), item]); // max 5 visible

    // Animate in
    Animated.spring(anim, {
      toValue: 1,
      useNativeDriver: false,
      friction: 8,
      tension: 100,
    }).start();

    // Auto dismiss
    setTimeout(() => {
      Animated.timing(anim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: false,
      }).start(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      });
    }, DISMISS_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toasts.length > 0 && (
        <View style={styles.container} pointerEvents="box-none">
          {toasts.map((toast, i) => {
            const colors = TYPE_COLORS[toast.type];
            return (
              <Animated.View
                key={toast.id}
                style={[
                  styles.toast,
                  {
                    backgroundColor: colors.bg,
                    borderColor: colors.border,
                    opacity: toast.anim,
                    transform: [{
                      translateX: toast.anim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [120, 0],
                      }),
                    }],
                  },
                ]}
              >
                <View style={[styles.iconBox, { backgroundColor: colors.text + '18' }]}>
                  <Text style={[styles.iconText, { color: colors.text }]}>{colors.icon}</Text>
                </View>
                <Text style={[styles.message, { color: colors.text }]} numberOfLines={2}>
                  {toast.message}
                </Text>
              </Animated.View>
            );
          })}
        </View>
      )}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute' as any,
    top: Platform.OS === 'web' ? 56 : 80,
    right: 12,
    zIndex: 9999,
    gap: 8,
    maxWidth: 320,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    ...Platform.select({
      web: {
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        backdropFilter: 'blur(8px)',
      } as any,
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 16,
        elevation: 8,
      },
    }),
  },
  iconBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  message: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
});

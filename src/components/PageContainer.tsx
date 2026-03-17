import React from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, useWindowDimensions } from 'react-native';

interface PageContainerProps {
  children: React.ReactNode;
  scrollable?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  centered?: boolean;
  wide?: boolean;
}

export default function PageContainer({ children, scrollable = true, refreshing, onRefresh, centered, wide }: PageContainerProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width > 768;
  const isMedium = width > 560;
  const maxW = wide ? (isDesktop ? 960 : (isMedium ? 640 : undefined)) : (isDesktop ? 640 : 480);

  const innerStyle = [styles.inner, maxW ? { maxWidth: maxW } : undefined];

  if (!scrollable) {
    return (
      <View style={[styles.container, centered && styles.centered]}>
        <View style={innerStyle}>{children}</View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scrollContent, centered && styles.centered]}
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={refreshing || false} onRefresh={onRefresh} tintColor="#fff" />
        ) : undefined
      }
    >
      <View style={innerStyle}>{children}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scrollContent: {
    flexGrow: 1,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  inner: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center' as const,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 28,
  },
});

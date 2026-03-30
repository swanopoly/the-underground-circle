import React, { useEffect, useRef } from 'react';
import { View, Animated, Platform, StyleSheet } from 'react-native';

interface Props {
  width: number | string;
  height: number;
}

export default function SkeletonLoader({ width, height }: Props) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    if (Platform.OS !== 'web') {
      const interval = setInterval(() => {
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0.7, duration: 750, useNativeDriver: false }),
          Animated.timing(opacity, { toValue: 0.3, duration: 750, useNativeDriver: false }),
        ]).start();
      }, 1500);
      return () => clearInterval(interval);
    }
  }, [opacity]);

  if (Platform.OS === 'web') {
    return (
      <View
        style={[
          sk.box,
          { width: width as any, height },
          // @ts-ignore — web-only CSS animation
          {
            animationName: 'skeletonPulse',
            animationDuration: '1.5s',
            animationIterationCount: 'infinite',
            animationTimingFunction: 'ease-in-out',
          },
        ] as any}
      />
    );
  }

  return (
    <Animated.View style={[sk.box, { width: width as any, height, opacity }]} />
  );
}

const sk = StyleSheet.create({
  box: {
    backgroundColor: '#252525',
    borderRadius: 2,
  },
});

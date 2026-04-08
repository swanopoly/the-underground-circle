/**
 * StaggerGroup — Renders children with staggered fade-slide-in delays.
 *
 * Wraps each child in a FadeSlideIn with incremental delay.
 */

import React from 'react';
import FadeSlideIn from './FadeSlideIn';

interface Props {
  children: React.ReactNode;
  staggerMs?: number;
  baseDelayMs?: number;
}

export default function StaggerGroup({
  children,
  staggerMs = 60,
  baseDelayMs = 200,
}: Props) {
  const childArray = React.Children.toArray(children);

  return (
    <>
      {childArray.map((child, index) => (
        <FadeSlideIn key={index} delay={baseDelayMs + index * staggerMs}>
          {child}
        </FadeSlideIn>
      ))}
    </>
  );
}

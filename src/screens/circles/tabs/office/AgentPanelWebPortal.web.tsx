import React from 'react';

const { createPortal } = require('react-dom') as {
  createPortal: (children: React.ReactNode, container: Element | DocumentFragment) => React.ReactPortal;
};

interface Props {
  children: React.ReactNode;
}

/**
 * Escape the Office floor's stacking context so a centered Agent dialog can
 * isolate persistent headers, trays, and Floating Chat with one real backdrop.
 */
export default function AgentPanelWebPortal({ children }: Props) {
  if (typeof document === 'undefined' || !document.body) return <>{children}</>;
  return createPortal(children, document.body);
}

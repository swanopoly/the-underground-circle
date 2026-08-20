import React from 'react';

interface Props {
  children: React.ReactNode;
}

/** Native fallback: the centered panel already lives in a React Native Modal. */
export default function AgentPanelWebPortal({ children }: Props) {
  return <>{children}</>;
}

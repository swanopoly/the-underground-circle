import React from 'react';
import ProfileScreen from '../../profile/ProfileScreen';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import AdaptiveWorkspaceCard from '../../../components/profile/AdaptiveWorkspaceCard';
import CompletedWorkPanel from '../../../components/CompletedWorkPanel';
import ComputerUseHistoryPanel from '../../../components/ComputerUseHistoryPanel';
import { useAuth } from '../../../hooks/useAuth';
import type { ComputerUseHistoryExactAuthority } from '../../../lib/computerUseHistory';

interface Props {
  circleId: string;
  navigation?: any;
}

export default function ProfileTab({ circleId, navigation }: Props) {
  const { user, session, loading: authLoading } = useAuth();
  const authorityRef = React.useRef<ComputerUseHistoryExactAuthority | null>(null);
  const authorityGenerationRef = React.useRef(0);
  const [committedAuthority, setCommittedAuthority] = React.useState<ComputerUseHistoryExactAuthority | null>(null);
  const authReady = !authLoading
    && Boolean(user?.id)
    && user?.id === session?.user.id
    && Boolean(session?.access_token);
  React.useEffect(() => {
    const generation = authorityGenerationRef.current + 1;
    authorityGenerationRef.current = generation;
    const authority = authReady && user?.id && session?.access_token
      ? Object.freeze({
          userId: user.id,
          circleId,
          accessToken: session.access_token,
          generation,
        })
      : null;
    authorityRef.current = authority;
    setCommittedAuthority(authority);
    return () => {
      authorityGenerationRef.current += 1;
      if (authorityRef.current?.generation === generation) authorityRef.current = null;
      setCommittedAuthority((current) => current?.generation === generation ? null : current);
    };
  }, [authReady, circleId, session?.access_token, user?.id]);
  const isAuthorityCurrent = React.useCallback((authority: ComputerUseHistoryExactAuthority): boolean => {
    const current = authorityRef.current;
    return Boolean(
      current
      && current.userId === authority.userId
      && current.circleId === authority.circleId
      && current.accessToken === authority.accessToken
      && current.generation === authority.generation
    );
  }, []);
  const exactAuthority = committedAuthority
    && committedAuthority.userId === user?.id
    && committedAuthority.circleId === circleId
    && committedAuthority.accessToken === session?.access_token
    && isAuthorityCurrent(committedAuthority)
      ? committedAuthority
      : null;

  // Re-runs from history route the task back into chat via a custom
  // event — ChatTab listens and pushes it through the Computer Use
  // orchestrator. Avoids having to hoist state between tabs.
  const handleRerun = React.useCallback((task: string) => {
    const requestedAuthority = exactAuthority;
    if (typeof window !== 'undefined' && requestedAuthority && isAuthorityCurrent(requestedAuthority)) {
      try {
        window.dispatchEvent(new CustomEvent('uc:run-computer-use', {
          detail: {
            task,
            circleId: requestedAuthority.circleId,
            userId: requestedAuthority.userId,
            authorityGeneration: requestedAuthority.generation,
          },
        }));
        window.dispatchEvent(new CustomEvent('uc:switch-tab', { detail: { tab: 'CHAT' } }));
      } catch {}
    }
  }, [exactAuthority, isAuthorityCurrent]);

  if (!exactAuthority) {
    return (
      <View style={{ padding: 24, alignItems: 'center', gap: 10 }}>
        <ActivityIndicator color="#6366f1" size="small" />
        <Text style={{ color: '#94a3b8' }}>Loading your private workspace…</Text>
      </View>
    );
  }

  const authorityKey = `${exactAuthority.userId}:${exactAuthority.circleId}:${exactAuthority.generation}`;
  return (
    <ScrollView key={authorityKey} contentContainerStyle={{ paddingBottom: 40 }}>
      <ProfileScreen navigation={navigation} />
      <CompletedWorkPanel circleId={circleId} />
      <ComputerUseHistoryPanel
        circleId={circleId}
        exactAuthority={exactAuthority}
        isExactAuthorityCurrent={isAuthorityCurrent}
        onRerun={handleRerun}
      />
      <AdaptiveWorkspaceCard circleId={circleId} />
    </ScrollView>
  );
}

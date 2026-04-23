import React from 'react';
import ProfileScreen from '../../profile/ProfileScreen';
import { ScrollView } from 'react-native';
import AdaptiveWorkspaceCard from '../../../components/profile/AdaptiveWorkspaceCard';
import CompletedWorkPanel from '../../../components/CompletedWorkPanel';
import ComputerUseHistoryPanel from '../../../components/ComputerUseHistoryPanel';

interface Props {
  circleId: string;
  navigation?: any;
}

export default function ProfileTab({ circleId, navigation }: Props) {
  // Re-runs from history route the task back into chat via a custom
  // event — ChatTab listens and pushes it through the Computer Use
  // orchestrator. Avoids having to hoist state between tabs.
  const handleRerun = React.useCallback((task: string) => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem('uc_pending_computer_use_task', task);
        window.dispatchEvent(new CustomEvent('uc:run-computer-use', { detail: { task } }));
        window.dispatchEvent(new CustomEvent('uc:switch-tab', { detail: { tab: 'CHAT' } }));
      } catch {}
    }
  }, []);
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      <ProfileScreen navigation={navigation} />
      <CompletedWorkPanel circleId={circleId} />
      <ComputerUseHistoryPanel circleId={circleId} onRerun={handleRerun} />
      <AdaptiveWorkspaceCard circleId={circleId} />
    </ScrollView>
  );
}

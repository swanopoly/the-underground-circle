import React from 'react';
import ProfileScreen from '../../profile/ProfileScreen';
import { ScrollView } from 'react-native';
import AdaptiveWorkspaceCard from '../../../components/profile/AdaptiveWorkspaceCard';

interface Props {
  circleId: string;
  navigation?: any;
}

export default function ProfileTab({ circleId, navigation }: Props) {
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      <ProfileScreen navigation={navigation} />
      <AdaptiveWorkspaceCard circleId={circleId} />
    </ScrollView>
  );
}

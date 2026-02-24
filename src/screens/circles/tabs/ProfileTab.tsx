import React from 'react';
import ProfileScreen from '../../profile/ProfileScreen';

interface Props {
  circleId: string;
  navigation?: any;
}

export default function ProfileTab({ circleId, navigation }: Props) {
  return <ProfileScreen navigation={navigation} />;
}

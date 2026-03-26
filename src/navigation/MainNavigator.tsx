import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import CirclesScreen from '../screens/circles/CirclesScreen';
import CircleDetailScreen from '../screens/circles/CircleDetailScreen';
import CreateCircleScreen from '../screens/circles/CreateCircleScreen';
import JoinCircleScreen from '../screens/circles/JoinCircleScreen';
import CircleSettingsScreen from '../screens/circles/CircleSettingsScreen';
import EditProfileScreen from '../screens/profile/EditProfileScreen';
import FriendsScreen from '../screens/friends/FriendsScreen';
import DMScreen from '../screens/friends/DMScreen';
import AgentsScreen from '../screens/agents/AgentsScreen';
import IntegrationsScreen from '../screens/integrations/IntegrationsScreen';
import InviteManageScreen from '../screens/circles/InviteManageScreen';
import OrgListScreen from '../screens/organizations/OrgListScreen';
import OrgDetailScreen from '../screens/organizations/OrgDetailScreen';
import CreateOrgScreen from '../screens/organizations/CreateOrgScreen';
import OrgSettingsScreen from '../screens/organizations/OrgSettingsScreen';
import BillingScreen from '../screens/organizations/BillingScreen';
import SSOConfigScreen from '../screens/organizations/SSOConfigScreen';
import GoalsScreen from '../screens/organizations/GoalsScreen';
import ReportsScreen from '../screens/organizations/ReportsScreen';
import WhiteLabelScreen from '../screens/organizations/WhiteLabelScreen';
import SchoolsScreen from '../screens/schools/SchoolsScreen';

const Stack = createNativeStackNavigator();

export default function MainNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#000000' },
      }}
    >
      <Stack.Screen name="CirclesList" component={CirclesScreen} />
      <Stack.Screen name="CreateCircle" component={CreateCircleScreen} />
      <Stack.Screen name="JoinCircle" component={JoinCircleScreen} />
      <Stack.Screen name="CircleDetail" component={CircleDetailScreen} />
      <Stack.Screen name="CircleSettings" component={CircleSettingsScreen} />
      {/* Profile sub-screens */}
      <Stack.Screen name="EditProfile" component={EditProfileScreen} />
      <Stack.Screen name="Friends" component={FriendsScreen} />
      <Stack.Screen name="DMScreen" component={DMScreen} />
      <Stack.Screen name="Agents" component={AgentsScreen} />
      <Stack.Screen name="Integrations" component={IntegrationsScreen} />
      <Stack.Screen name="InviteManage" component={InviteManageScreen} />
      {/* Organization screens */}
      <Stack.Screen name="OrgList" component={OrgListScreen} />
      <Stack.Screen name="OrgDetail" component={OrgDetailScreen} />
      <Stack.Screen name="CreateOrg" component={CreateOrgScreen} />
      <Stack.Screen name="OrgSettings" component={OrgSettingsScreen} />
      <Stack.Screen name="Billing" component={BillingScreen} />
      <Stack.Screen name="SSOConfig" component={SSOConfigScreen} />
      <Stack.Screen name="Goals" component={GoalsScreen} />
      <Stack.Screen name="Reports" component={ReportsScreen} />
      <Stack.Screen name="WhiteLabel" component={WhiteLabelScreen} />
      {/* Schools */}
      <Stack.Screen name="Schools" component={SchoolsScreen} />
    </Stack.Navigator>
  );
}

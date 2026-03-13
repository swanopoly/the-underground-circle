import React, { lazy, Suspense } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Core screens — always needed on the primary navigation path
import CirclesScreen from '../screens/circles/CirclesScreen';
import CircleDetailScreen from '../screens/circles/CircleDetailScreen';

// Lazy-load all secondary screens — only loaded when navigated to
const CreateCircleScreen = lazy(() => import('../screens/circles/CreateCircleScreen'));
const JoinCircleScreen = lazy(() => import('../screens/circles/JoinCircleScreen'));
const CircleSettingsScreen = lazy(() => import('../screens/circles/CircleSettingsScreen'));
const EditProfileScreen = lazy(() => import('../screens/profile/EditProfileScreen'));
const FriendsScreen = lazy(() => import('../screens/friends/FriendsScreen'));
const DMScreen = lazy(() => import('../screens/friends/DMScreen'));
const AgentsScreen = lazy(() => import('../screens/agents/AgentsScreen'));
const IntegrationsScreen = lazy(() => import('../screens/integrations/IntegrationsScreen'));
const InviteManageScreen = lazy(() => import('../screens/circles/InviteManageScreen'));
const OrgListScreen = lazy(() => import('../screens/organizations/OrgListScreen'));
const OrgDetailScreen = lazy(() => import('../screens/organizations/OrgDetailScreen'));
const CreateOrgScreen = lazy(() => import('../screens/organizations/CreateOrgScreen'));
const OrgSettingsScreen = lazy(() => import('../screens/organizations/OrgSettingsScreen'));
const BillingScreen = lazy(() => import('../screens/organizations/BillingScreen'));
const SSOConfigScreen = lazy(() => import('../screens/organizations/SSOConfigScreen'));
const GoalsScreen = lazy(() => import('../screens/organizations/GoalsScreen'));
const ReportsScreen = lazy(() => import('../screens/organizations/ReportsScreen'));
const WhiteLabelScreen = lazy(() => import('../screens/organizations/WhiteLabelScreen'));
const SchoolsScreen = lazy(() => import('../screens/schools/SchoolsScreen'));

const Stack = createNativeStackNavigator();

/** Wraps a lazy component so it works with React Navigation's component prop */
function lazyScreen(LazyComponent: React.LazyExoticComponent<React.ComponentType<any>>) {
  return function LazyScreenWrapper(props: any) {
    return (
      <Suspense fallback={
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }}>
          <ActivityIndicator color="#6366f1" size="small" />
        </View>
      }>
        <LazyComponent {...props} />
      </Suspense>
    );
  };
}

// Hoist wrapped components to module scope so React Navigation gets stable references
const LazyCreateCircle = lazyScreen(CreateCircleScreen);
const LazyJoinCircle = lazyScreen(JoinCircleScreen);
const LazyCircleSettings = lazyScreen(CircleSettingsScreen);
const LazyEditProfile = lazyScreen(EditProfileScreen);
const LazyFriends = lazyScreen(FriendsScreen);
const LazyDM = lazyScreen(DMScreen);
const LazyAgents = lazyScreen(AgentsScreen);
const LazyIntegrations = lazyScreen(IntegrationsScreen);
const LazyInviteManage = lazyScreen(InviteManageScreen);
const LazyOrgList = lazyScreen(OrgListScreen);
const LazyOrgDetail = lazyScreen(OrgDetailScreen);
const LazyCreateOrg = lazyScreen(CreateOrgScreen);
const LazyOrgSettings = lazyScreen(OrgSettingsScreen);
const LazyBilling = lazyScreen(BillingScreen);
const LazySSOConfig = lazyScreen(SSOConfigScreen);
const LazyGoals = lazyScreen(GoalsScreen);
const LazyReports = lazyScreen(ReportsScreen);
const LazyWhiteLabel = lazyScreen(WhiteLabelScreen);
const LazySchools = lazyScreen(SchoolsScreen);

export default function MainNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#000000' },
      }}
    >
      <Stack.Screen name="CirclesList" component={CirclesScreen} />
      <Stack.Screen name="CreateCircle" component={LazyCreateCircle} />
      <Stack.Screen name="JoinCircle" component={LazyJoinCircle} />
      <Stack.Screen name="CircleDetail" component={CircleDetailScreen} />
      <Stack.Screen name="CircleSettings" component={LazyCircleSettings} />
      {/* Profile sub-screens */}
      <Stack.Screen name="EditProfile" component={LazyEditProfile} />
      <Stack.Screen name="Friends" component={LazyFriends} />
      <Stack.Screen name="DMScreen" component={LazyDM} />
      <Stack.Screen name="Agents" component={LazyAgents} />
      <Stack.Screen name="Integrations" component={LazyIntegrations} />
      <Stack.Screen name="InviteManage" component={LazyInviteManage} />
      {/* Organization screens */}
      <Stack.Screen name="OrgList" component={LazyOrgList} />
      <Stack.Screen name="OrgDetail" component={LazyOrgDetail} />
      <Stack.Screen name="CreateOrg" component={LazyCreateOrg} />
      <Stack.Screen name="OrgSettings" component={LazyOrgSettings} />
      <Stack.Screen name="Billing" component={LazyBilling} />
      <Stack.Screen name="SSOConfig" component={LazySSOConfig} />
      <Stack.Screen name="Goals" component={LazyGoals} />
      <Stack.Screen name="Reports" component={LazyReports} />
      <Stack.Screen name="WhiteLabel" component={LazyWhiteLabel} />
      {/* Schools */}
      <Stack.Screen name="Schools" component={LazySchools} />
    </Stack.Navigator>
  );
}

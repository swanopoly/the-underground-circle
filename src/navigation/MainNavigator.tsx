import React, { Suspense } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

const Stack = createNativeStackNavigator();

function ScreenFallback() {
  return (
    <View style={styles.fallback}>
      <Text style={styles.fallbackText}>Loading...</Text>
    </View>
  );
}

function lazyScreen(loader: () => Promise<{ default: React.ComponentType<any> }>, name: string) {
  const LazyComponent = React.lazy(loader);
  function LazyScreen(props: any) {
    return (
      <Suspense fallback={<ScreenFallback />}>
        <LazyComponent {...props} />
      </Suspense>
    );
  }
  LazyScreen.displayName = `Lazy${name}`;
  return LazyScreen;
}

const CirclesScreen = lazyScreen(() => import('../screens/circles/CirclesScreen'), 'CirclesScreen');
const CircleDetailScreen = lazyScreen(() => import('../screens/circles/CircleDetailScreen'), 'CircleDetailScreen');
const CreateCircleScreen = lazyScreen(() => import('../screens/circles/CreateCircleScreen'), 'CreateCircleScreen');
const DiscoverScreen = lazyScreen(() => import('../screens/circles/DiscoverScreen'), 'DiscoverScreen');
const JoinCircleScreen = lazyScreen(() => import('../screens/circles/JoinCircleScreen'), 'JoinCircleScreen');
const CircleSettingsScreen = lazyScreen(() => import('../screens/circles/CircleSettingsScreen'), 'CircleSettingsScreen');
const ProfileScreen = lazyScreen(() => import('../screens/profile/ProfileScreen'), 'ProfileScreen');
const EditProfileScreen = lazyScreen(() => import('../screens/profile/EditProfileScreen'), 'EditProfileScreen');
const FriendsScreen = lazyScreen(() => import('../screens/friends/FriendsScreen'), 'FriendsScreen');
const DMScreen = lazyScreen(() => import('../screens/friends/DMScreen'), 'DMScreen');
const AgentsScreen = lazyScreen(() => import('../screens/agents/AgentsScreenLive'), 'AgentsScreen');
const IntegrationsScreen = lazyScreen(() => import('../screens/integrations/IntegrationsScreen'), 'IntegrationsScreen');
const InviteManageScreen = lazyScreen(() => import('../screens/circles/InviteManageScreen'), 'InviteManageScreen');
const OrgListScreen = lazyScreen(() => import('../screens/organizations/OrgListScreen'), 'OrgListScreen');
const OrgDetailScreen = lazyScreen(() => import('../screens/organizations/OrgDetailScreen'), 'OrgDetailScreen');
const CreateOrgScreen = lazyScreen(() => import('../screens/organizations/CreateOrgScreen'), 'CreateOrgScreen');
const OrgSettingsScreen = lazyScreen(() => import('../screens/organizations/OrgSettingsScreen'), 'OrgSettingsScreen');
const BillingScreen = lazyScreen(() => import('../screens/organizations/BillingScreen'), 'BillingScreen');
const SSOConfigScreen = lazyScreen(() => import('../screens/organizations/SSOConfigScreen'), 'SSOConfigScreen');
const GoalsScreen = lazyScreen(() => import('../screens/organizations/GoalsScreen'), 'GoalsScreen');
const ReportsScreen = lazyScreen(() => import('../screens/organizations/ReportsScreen'), 'ReportsScreen');
const WhiteLabelScreen = lazyScreen(() => import('../screens/organizations/WhiteLabelScreen'), 'WhiteLabelScreen');
const SchoolsScreen = lazyScreen(() => import('../screens/schools/SchoolsScreen'), 'SchoolsScreen');
const SchoolsTrackScreen = lazyScreen(() => import('../screens/schools/SchoolsTrackScreen'), 'SchoolsTrackScreen');
const SchoolsModuleScreen = lazyScreen(() => import('../screens/schools/SchoolsModuleScreen'), 'SchoolsModuleScreen');
const SchoolsLessonScreen = lazyScreen(() => import('../screens/schools/SchoolsLessonScreen'), 'SchoolsLessonScreen');
const WikiScreen = lazyScreen(() => import('../screens/wiki/WikiScreen'), 'WikiScreen');
const WikiCategoryScreen = lazyScreen(() => import('../screens/wiki/WikiCategoryScreen'), 'WikiCategoryScreen');
const WikiArticleScreen = lazyScreen(() => import('../screens/wiki/WikiArticleScreen'), 'WikiArticleScreen');
const ResearchControlCenterScreen = lazyScreen(() => import('../screens/wiki/ResearchControlCenterScreen'), 'ResearchControlCenterScreen');
const ResearchDocumentDetailScreen = lazyScreen(() => import('../screens/wiki/ResearchDocumentDetailScreen'), 'ResearchDocumentDetailScreen');
const ResearchRunDetailScreen = lazyScreen(() => import('../screens/wiki/ResearchRunDetailScreen'), 'ResearchRunDetailScreen');
const SoulMemoryScreen = lazyScreen(() => import('../screens/wiki/SoulMemoryScreen'), 'SoulMemoryScreen');

export default function MainNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0A0A0A' },
      }}
    >
      <Stack.Screen name="CirclesList" component={CirclesScreen} />
      <Stack.Screen name="CreateCircle" component={CreateCircleScreen} />
      <Stack.Screen name="Discover" component={DiscoverScreen} />
      <Stack.Screen name="JoinCircle" component={JoinCircleScreen} />
      <Stack.Screen name="CircleDetail" component={CircleDetailScreen} />
      <Stack.Screen name="CircleSettings" component={CircleSettingsScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="EditProfile" component={EditProfileScreen} />
      <Stack.Screen name="Friends" component={FriendsScreen} />
      <Stack.Screen name="DMScreen" component={DMScreen} />
      <Stack.Screen name="Agents" component={AgentsScreen} />
      <Stack.Screen name="Integrations" component={IntegrationsScreen} />
      <Stack.Screen name="InviteManage" component={InviteManageScreen} />
      <Stack.Screen name="OrgList" component={OrgListScreen} />
      <Stack.Screen name="OrgDetail" component={OrgDetailScreen} />
      <Stack.Screen name="CreateOrg" component={CreateOrgScreen} />
      <Stack.Screen name="OrgSettings" component={OrgSettingsScreen} />
      <Stack.Screen name="Billing" component={BillingScreen} />
      <Stack.Screen name="SSOConfig" component={SSOConfigScreen} />
      <Stack.Screen name="Goals" component={GoalsScreen} />
      <Stack.Screen name="Reports" component={ReportsScreen} />
      <Stack.Screen name="WhiteLabel" component={WhiteLabelScreen} />
      <Stack.Screen name="Schools" component={SchoolsScreen} />
      <Stack.Screen name="SchoolsTrack" component={SchoolsTrackScreen} />
      <Stack.Screen name="SchoolsModule" component={SchoolsModuleScreen} />
      <Stack.Screen name="SchoolsLesson" component={SchoolsLessonScreen} />
      <Stack.Screen name="Wiki" component={WikiScreen} />
      <Stack.Screen name="ResearchControlCenter" component={ResearchControlCenterScreen} />
      <Stack.Screen name="ResearchDocumentDetail" component={ResearchDocumentDetailScreen} />
      <Stack.Screen name="ResearchRunDetail" component={ResearchRunDetailScreen} />
      <Stack.Screen name="SoulMemory" component={SoulMemoryScreen} />
      <Stack.Screen name="WikiCategory" component={WikiCategoryScreen} />
      <Stack.Screen name="WikiArticle" component={WikiArticleScreen} />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackText: {
    color: '#8b8b96',
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
});

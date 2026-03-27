import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Alert,
  Share,
  Platform,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { Friend, FriendRequest } from '../../types';
import Card from '../../components/Card';
import Button from '../../components/Button';
import {
  getFriends,
  getFriendRequests,
  sendFriendRequest,
  respondToFriendRequest,
  removeFriend,
  generateInviteLink,
  searchUsers,
} from '../../lib/integrations';

type Tab = 'friends' | 'requests' | 'search';

export default function FriendsScreen({ navigation }: any) {
  const [activeTab, setActiveTab] = useState<Tab>('friends');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>('');

  useEffect(() => {
    loadData();
    getCurrentUser();
  }, []);

  const getCurrentUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setCurrentUserId(user.id);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [friendsData, requestsData] = await Promise.all([
        getFriends(),
        getFriendRequests(),
      ]);
      setFriends(friendsData);
      setFriendRequests(requestsData);
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
    setLoading(false);
  };

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    try {
      const results = await searchUsers(query.trim());
      // Filter out current user and existing friends
      const friendIds = new Set(friends.map(f => f.friend_id));
      const filteredResults = results.filter(
        user => user.id !== currentUserId && !friendIds.has(user.id)
      );
      setSearchResults(filteredResults);
    } catch (error: any) {
      console.error('Search error:', error);
    }
  };

  const handleSendRequest = async (receiverId: string) => {
    try {
      await sendFriendRequest(receiverId, 'Hey! Let\'s connect on The Underground Circle!');
      Alert.alert('Success', 'Friend request sent!');
      loadData(); // Refresh data
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  const handleRespondToRequest = async (requestId: string, accept: boolean) => {
    try {
      await respondToFriendRequest(requestId, accept);
      Alert.alert('Success', accept ? 'Friend request accepted!' : 'Friend request declined');
      loadData(); // Refresh data
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  const handleRemoveFriend = (friendId: string, friendName: string) => {
    const confirmRemove = () => {
      Alert.alert(
        'Remove Friend',
        `Are you sure you want to remove ${friendName} from your friends?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              try {
                await removeFriend(friendId);
                Alert.alert('Success', 'Friend removed');
                loadData();
              } catch (error: any) {
                Alert.alert('Error', error.message);
              }
            },
          },
        ]
      );
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Remove ${friendName} from your friends?`)) {
        removeFriend(friendId).then(() => {
          Alert.alert('Success', 'Friend removed');
          loadData();
        }).catch((error: any) => {
          Alert.alert('Error', error.message);
        });
      }
    } else {
      confirmRemove();
    }
  };

  const handleGenerateInvite = async () => {
    try {
      const inviteLink = await generateInviteLink();
      
      if (Platform.OS === 'web') {
        navigator.clipboard.writeText(inviteLink);
        Alert.alert('Success', 'Invite link copied to clipboard!');
      } else {
        Share.share({
          message: `Join me on The Underground Circle! ${inviteLink}`,
          title: 'Join The Underground Circle',
        });
      }
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  const handleOpenDM = (friend: Friend) => {
    navigation.navigate('DMScreen', { 
      friendId: friend.friend_id, 
      friendName: friend.friend?.display_name || friend.friend?.username 
    });
  };

  const pendingRequests = friendRequests.filter(r => 
    r.status === 'pending' && r.receiver_id === currentUserId
  );
  const sentRequests = friendRequests.filter(r => 
    r.status === 'pending' && r.sender_id === currentUserId
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.headerBack}>← BACK</Text>
        </Pressable>
        <Text style={styles.headerTitle}>FRIENDS</Text>
        <Pressable onPress={handleGenerateInvite}>
          <Text style={styles.inviteButton}>INVITE</Text>
        </Pressable>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {(['friends', 'requests', 'search'] as Tab[]).map(tab => (
          <Pressable
            key={tab}
            style={[styles.tab, activeTab === tab && styles.activeTab]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>
              {tab.toUpperCase()}
              {tab === 'requests' && pendingRequests.length > 0 && (
                <Text style={styles.badge}> {pendingRequests.length}</Text>
              )}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.inner}>
          {/* Friends Tab */}
          {activeTab === 'friends' && (
            <View>
              {friends.length === 0 ? (
                <Card style={styles.emptyCard}>
                  <Text style={styles.emptyTitle}>No Friends Yet</Text>
                  <Text style={styles.emptyDesc}>
                    Start building your network by searching for users or inviting friends!
                  </Text>
                </Card>
              ) : (
                friends.map(friend => (
                  <Card key={friend.id} style={styles.friendCard}>
                    <View style={styles.friendInfo}>
                      <View style={styles.friendAvatar}>
                        <Text style={styles.friendAvatarText}>
                          {friend.friend?.display_name?.charAt(0)?.toUpperCase() || '?'}
                        </Text>
                      </View>
                      <View style={styles.friendDetails}>
                        <Text style={styles.friendName}>
                          {friend.friend?.display_name || 'Unknown'}
                        </Text>
                        <Text style={styles.friendUsername}>
                          @{friend.friend?.username || 'unknown'}
                        </Text>
                        <Text style={styles.friendSince}>
                          Friends since {new Date(friend.since).toLocaleDateString()}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.friendActions}>
                      <Button
                        title="MESSAGE"
                        variant="secondary"
                        onPress={() => handleOpenDM(friend)}
                        style={styles.actionButton}
                      />
                      <Pressable
                        style={styles.removeButton}
                        onPress={() => handleRemoveFriend(
                          friend.friend_id, 
                          friend.friend?.display_name || 'Friend'
                        )}
                      >
                        <Text style={styles.removeButtonText}>×</Text>
                      </Pressable>
                    </View>
                  </Card>
                ))
              )}
            </View>
          )}

          {/* Requests Tab */}
          {activeTab === 'requests' && (
            <View>
              {/* Pending Incoming Requests */}
              {pendingRequests.length > 0 && (
                <View>
                  <Text style={styles.sectionTitle}>INCOMING REQUESTS</Text>
                  {pendingRequests.map(request => (
                    <Card key={request.id} style={styles.requestCard}>
                      <View style={styles.friendInfo}>
                        <View style={styles.friendAvatar}>
                          <Text style={styles.friendAvatarText}>
                            {request.sender?.display_name?.charAt(0)?.toUpperCase() || '?'}
                          </Text>
                        </View>
                        <View style={styles.friendDetails}>
                          <Text style={styles.friendName}>
                            {request.sender?.display_name || 'Unknown'}
                          </Text>
                          <Text style={styles.friendUsername}>
                            @{request.sender?.username || 'unknown'}
                          </Text>
                          {request.message && (
                            <Text style={styles.requestMessage}>{request.message}</Text>
                          )}
                        </View>
                      </View>
                      <View style={styles.requestActions}>
                        <Button
                          title="ACCEPT"
                          onPress={() => handleRespondToRequest(request.id, true)}
                          style={styles.acceptButton}
                        />
                        <Button
                          title="DECLINE"
                          variant="ghost"
                          onPress={() => handleRespondToRequest(request.id, false)}
                          style={styles.declineButton}
                        />
                      </View>
                    </Card>
                  ))}
                </View>
              )}

              {/* Sent Requests */}
              {sentRequests.length > 0 && (
                <View style={{ marginTop: pendingRequests.length > 0 ? 24 : 0 }}>
                  <Text style={styles.sectionTitle}>SENT REQUESTS</Text>
                  {sentRequests.map(request => (
                    <Card key={request.id} style={styles.requestCard}>
                      <View style={styles.friendInfo}>
                        <View style={styles.friendAvatar}>
                          <Text style={styles.friendAvatarText}>
                            {request.receiver?.display_name?.charAt(0)?.toUpperCase() || '?'}
                          </Text>
                        </View>
                        <View style={styles.friendDetails}>
                          <Text style={styles.friendName}>
                            {request.receiver?.display_name || 'Unknown'}
                          </Text>
                          <Text style={styles.friendUsername}>
                            @{request.receiver?.username || 'unknown'}
                          </Text>
                          <Text style={styles.pendingText}>Request pending...</Text>
                        </View>
                      </View>
                    </Card>
                  ))}
                </View>
              )}

              {pendingRequests.length === 0 && sentRequests.length === 0 && (
                <Card style={styles.emptyCard}>
                  <Text style={styles.emptyTitle}>No Friend Requests</Text>
                  <Text style={styles.emptyDesc}>
                    When you send or receive friend requests, they'll appear here.
                  </Text>
                </Card>
              )}
            </View>
          )}

          {/* Search Tab */}
          {activeTab === 'search' && (
            <View>
              <Card style={styles.searchCard}>
                <TextInput
                  style={styles.searchInput}
                  value={searchQuery}
                  onChangeText={handleSearch}
                  placeholder="Search by username or display name..."
                  placeholderTextColor="#444"
                />
              </Card>

              {searchResults.length > 0 && (
                <View>
                  <Text style={styles.sectionTitle}>SEARCH RESULTS</Text>
                  {searchResults.map(user => (
                    <Card key={user.id} style={styles.friendCard}>
                      <View style={styles.friendInfo}>
                        <View style={styles.friendAvatar}>
                          <Text style={styles.friendAvatarText}>
                            {user.display_name?.charAt(0)?.toUpperCase() || '?'}
                          </Text>
                        </View>
                        <View style={styles.friendDetails}>
                          <Text style={styles.friendName}>{user.display_name}</Text>
                          <Text style={styles.friendUsername}>@{user.username}</Text>
                          <Text style={styles.userLevel}>
                            Level {user.level || 1} • {(user.xp || 0).toLocaleString()} XP
                          </Text>
                        </View>
                      </View>
                      <Button
                        title="ADD FRIEND"
                        onPress={() => handleSendRequest(user.id)}
                        style={styles.actionButton}
                      />
                    </Card>
                  ))}
                </View>
              )}

              {searchQuery.length >= 2 && searchResults.length === 0 && (
                <Card style={styles.emptyCard}>
                  <Text style={styles.emptyTitle}>No Users Found</Text>
                  <Text style={styles.emptyDesc}>
                    Try searching with a different username or display name.
                  </Text>
                </Card>
              )}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
    maxWidth: 720,
    alignSelf: 'center',
    width: '100%',
  },
  headerBack: { color: '#6366f1', fontSize: 14, fontWeight: '700' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: 2 },
  inviteButton: { color: '#6366f1', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
    maxWidth: 720,
    alignSelf: 'center',
    width: '100%',
  },
  tab: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: '#6366f1',
  },
  tabText: {
    color: '#666',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  activeTabText: {
    color: '#fff',
  },
  badge: {
    color: '#6366f1',
    backgroundColor: 'transparent',
  },

  scrollContent: { flexGrow: 1 },
  inner: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
  },

  sectionTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 12,
    marginTop: 8,
  },

  // Friends
  friendCard: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between',
    marginBottom: 12,
    padding: 16,
  },
  friendInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  friendAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  friendAvatarText: { color: '#fff', fontSize: 18, fontWeight: '900' },
  friendDetails: { flex: 1 },
  friendName: { color: '#fff', fontSize: 16, fontWeight: '700' },
  friendUsername: { color: '#666', fontSize: 12, marginTop: 2 },
  friendSince: { color: '#444', fontSize: 10, marginTop: 2 },
  userLevel: { color: '#888', fontSize: 11, marginTop: 2 },
  friendActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionButton: { minHeight: 32, paddingHorizontal: 12 },
  removeButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeButtonText: { color: '#fff', fontSize: 16, fontWeight: '900' },

  // Requests
  requestCard: { marginBottom: 12, padding: 16 },
  requestMessage: { color: '#888', fontSize: 12, marginTop: 4, fontStyle: 'italic' },
  pendingText: { color: '#f59e0b', fontSize: 11, marginTop: 2 },
  requestActions: { 
    flexDirection: 'row', 
    gap: 8, 
    marginTop: 12,
    justifyContent: 'flex-end',
  },
  acceptButton: { minHeight: 32, paddingHorizontal: 16 },
  declineButton: { minHeight: 32, paddingHorizontal: 16 },

  // Search
  searchCard: { marginBottom: 16 },
  searchInput: {
    backgroundColor: 'transparent',
    color: '#fff',
    fontSize: 14,
    padding: 0,
  },

  // Empty states
  emptyCard: { alignItems: 'center', padding: 32 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptyDesc: { color: '#666', fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
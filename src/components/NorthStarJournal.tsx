import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView
} from 'react-native';
import { storage } from '../lib/storage';
import { supabase } from '../lib/supabase';

interface NorthStarEntry {
  intention: string;
  priority: string;
  energy: string;
  timestamp: string;
}

interface Props {
  onComplete: (entry: NorthStarEntry) => void;
  isBlocking?: boolean; // If true, blocks access to other features until complete
}

export const NorthStarJournal: React.FC<Props> = ({ onComplete, isBlocking = true }) => {
  const [intention, setIntention] = useState('');
  const [priority, setPriority] = useState('');
  const [energy, setEnergy] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasCompletedToday, setHasCompletedToday] = useState(false);

  useEffect(() => {
    checkTodayCompletion();
  }, []);

  const checkTodayCompletion = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const stored = await storage.getItem(`north-star-${today}`);
      if (stored) {
        setHasCompletedToday(true);
      }
    } catch (error) {
      console.error('Error checking completion:', error);
    }
  };

  const handleSubmit = async () => {
    if (!intention.trim() || !priority.trim() || !energy.trim()) {
      Alert.alert('Incomplete', 'Please answer all three questions to set your North Star for today.');
      return;
    }

    setIsSubmitting(true);

    try {
      const entry: NorthStarEntry = {
        intention: intention.trim(),
        priority: priority.trim(),
        energy: energy.trim(),
        timestamp: new Date().toISOString()
      };

      // Save to local storage
      const today = new Date().toISOString().split('T')[0];
      await storage.setItem(`north-star-${today}`, JSON.stringify(entry));

      // Save to Supabase
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from('north_star_entries')
          .insert({
            user_id: user.id,
            intention: entry.intention,
            priority: entry.priority,
            energy: entry.energy,
            date: today,
            created_at: entry.timestamp
          });
      }

      setHasCompletedToday(true);
      onComplete(entry);
    } catch (error) {
      console.error('Error saving North Star entry:', error);
      Alert.alert('Error', 'Failed to save your North Star. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = () => {
    if (!isBlocking) {
      onComplete({
        intention: '',
        priority: '',
        energy: '',
        timestamp: new Date().toISOString()
      });
    }
  };

  if (hasCompletedToday && !isBlocking) {
    return null;
  }

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>☀️ Morning North Star</Text>
          <Text style={styles.subtitle}>
            Set your intention before diving into your day
          </Text>
        </View>

        <View style={styles.form}>
          <View style={styles.questionContainer}>
            <Text style={styles.question}>
              What is your main intention for today?
            </Text>
            <Text style={styles.hint}>
              (What energy do you want to bring to the world?)
            </Text>
            <TextInput
              style={styles.textInput}
              value={intention}
              onChangeText={setIntention}
              placeholder="Be present, create value, show love..."
              multiline
              maxLength={200}
              editable={!hasCompletedToday}
            />
          </View>

          <View style={styles.questionContainer}>
            <Text style={styles.question}>
              What's your highest-leverage priority?
            </Text>
            <Text style={styles.hint}>
              (If you could only complete one thing today, what would it be?)
            </Text>
            <TextInput
              style={styles.textInput}
              value={priority}
              onChangeText={setPriority}
              placeholder="Ship the new feature, call Mom, finish proposal..."
              multiline
              maxLength={150}
              editable={!hasCompletedToday}
            />
          </View>

          <View style={styles.questionContainer}>
            <Text style={styles.question}>
              How is your energy right now?
            </Text>
            <Text style={styles.hint}>
              (Rate 1-5 and add context: sleep, mood, physical state)
            </Text>
            <TextInput
              style={styles.textInput}
              value={energy}
              onChangeText={setEnergy}
              placeholder="4/5 - slept well, feeling focused but need coffee"
              multiline
              maxLength={100}
              editable={!hasCompletedToday}
            />
          </View>
        </View>

        {!hasCompletedToday && (
          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[styles.button, styles.primaryButton]}
              onPress={handleSubmit}
              disabled={isSubmitting}
            >
              <Text style={styles.buttonText}>
                {isSubmitting ? 'Setting North Star...' : '🧭 Set North Star'}
              </Text>
            </TouchableOpacity>

            {!isBlocking && (
              <TouchableOpacity
                style={[styles.button, styles.secondaryButton]}
                onPress={handleSkip}
                disabled={isSubmitting}
              >
                <Text style={styles.secondaryButtonText}>Skip for Now</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {hasCompletedToday && (
          <View style={styles.completedContainer}>
            <Text style={styles.completedText}>✅ North Star Set</Text>
            <Text style={styles.completedSubtext}>
              Your intentions are captured. Go make it happen!
            </Text>
          </View>
        )}

        {isBlocking && (
          <View style={styles.blockingNotice}>
            <Text style={styles.blockingText}>
              🔒 Complete your North Star to unlock The Underground Circle
            </Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  scrollContent: {
    flexGrow: 1,
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 30,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#a0a0a0',
    textAlign: 'center',
    lineHeight: 22,
  },
  form: {
    flex: 1,
  },
  questionContainer: {
    marginBottom: 30,
  },
  question: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  hint: {
    fontSize: 14,
    color: '#808080',
    fontStyle: 'italic',
    marginBottom: 12,
  },
  textInput: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    color: '#ffffff',
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: '#3a3a3a',
  },
  buttonContainer: {
    marginTop: 30,
  },
  button: {
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: '#4CAF50',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#555555',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButtonText: {
    color: '#a0a0a0',
    fontSize: 16,
    fontWeight: '500',
  },
  completedContainer: {
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#2a4a2a',
    borderRadius: 12,
    marginTop: 20,
  },
  completedText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#4CAF50',
    marginBottom: 8,
  },
  completedSubtext: {
    fontSize: 16,
    color: '#a0a0a0',
    textAlign: 'center',
  },
  blockingNotice: {
    backgroundColor: '#3a2a2a',
    padding: 16,
    borderRadius: 12,
    marginTop: 20,
    alignItems: 'center',
  },
  blockingText: {
    color: '#ffaa00',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
});

export default NorthStarJournal;
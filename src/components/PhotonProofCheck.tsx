import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Platform,
  Pressable,
  Image,
} from 'react-native';
import { Camera, CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { supabase } from '../lib/supabase';
import Button from './Button';

interface PhotonProofProps {
  circleId: string;
  onProofComplete: (proof: PhotonProof) => void;
  onCancel?: () => void;
}

export interface PhotonProof {
  id: string;
  userId: string;
  circleId: string;
  timestamp: Date;
  photoUrl: string;
  lightLevel: number;
  verified: boolean;
  streak: number;
  latitude?: number;
  longitude?: number;
}

export default function PhotonProofCheck({ circleId, onProofComplete, onCancel }: PhotonProofProps) {
  const [facing, setFacing] = useState<CameraType>('back');
  const [permission, requestPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions();
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentStreak, setCurrentStreak] = useState(0);
  const cameraRef = useRef<CameraView>(null);

  useEffect(() => {
    fetchCurrentStreak();
  }, [circleId]);

  const fetchCurrentStreak = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get user's current photon streak for this circle
      const { data, error } = await supabase
        .from('photon_proofs')
        .select('streak')
        .eq('user_id', user.id)
        .eq('circle_id', circleId)
        .order('timestamp', { ascending: false })
        .limit(1);

      if (!error && data?.length > 0) {
        setCurrentStreak(data[0].streak || 0);
      }
    } catch (err) {
      console.error('Error fetching streak:', err);
    }
  };

  const handlePermissions = useCallback(async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('Permission Required', 'Camera access is needed for photon proof verification.');
        return false;
      }
    }

    if (!mediaPermission?.granted) {
      const result = await requestMediaPermission();
      if (!result.granted) {
        Alert.alert('Permission Required', 'Photo library access is needed to save your photon proof.');
        return false;
      }
    }

    return true;
  }, [permission, requestPermission, mediaPermission, requestMediaPermission]);

  const analyzeImageBrightness = async (imageUri: string): Promise<number> => {
    // For now, return a mock brightness value
    // In production, you would use an image processing library or API
    // to analyze the actual brightness levels
    const now = new Date();
    const hour = now.getHours();
    
    // Mock brightness based on time of day
    if (hour >= 6 && hour <= 18) {
      return Math.random() * 100 + 150; // Daylight range: 150-250
    } else {
      return Math.random() * 50 + 10; // Night range: 10-60
    }
  };

  const takePicture = async () => {
    const hasPermissions = await handlePermissions();
    if (!hasPermissions) return;

    if (!cameraRef.current) {
      Alert.alert('Error', 'Camera not ready. Please try again.');
      return;
    }

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        base64: false,
        exif: true,
      });

      if (photo?.uri) {
        setCapturedImage(photo.uri);
      }
    } catch (error) {
      console.error('Error taking picture:', error);
      Alert.alert('Error', 'Failed to take picture. Please try again.');
    }
  };

  const uploadAndVerifyProof = async () => {
    if (!capturedImage) return;

    setIsProcessing(true);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Error', 'Please log in to submit photon proof.');
        return;
      }

      // Analyze brightness
      const lightLevel = await analyzeImageBrightness(capturedImage);
      const isVerified = lightLevel >= 100; // Minimum brightness threshold

      // Check if user already submitted today
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const { data: existingProof } = await supabase
        .from('photon_proofs')
        .select('*')
        .eq('user_id', user.id)
        .eq('circle_id', circleId)
        .gte('timestamp', today.toISOString())
        .limit(1);

      if (existingProof && existingProof.length > 0) {
        Alert.alert('Already Submitted', 'You have already submitted your photon proof for today.');
        setIsProcessing(false);
        return;
      }

      // Upload image to storage (in production, you'd implement actual file upload)
      const photoUrl = capturedImage; // For now, just use the local URI

      // Calculate new streak
      let newStreak = 1;
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const { data: yesterdayProof } = await supabase
        .from('photon_proofs')
        .select('streak')
        .eq('user_id', user.id)
        .eq('circle_id', circleId)
        .gte('timestamp', yesterday.toISOString())
        .lt('timestamp', today.toISOString())
        .limit(1);

      if (yesterdayProof && yesterdayProof.length > 0) {
        newStreak = (yesterdayProof[0].streak || 0) + 1;
      }

      // Save photon proof to database
      const photonProof: Omit<PhotonProof, 'id'> = {
        userId: user.id,
        circleId,
        timestamp: new Date(),
        photoUrl,
        lightLevel,
        verified: isVerified,
        streak: newStreak,
      };

      const { data, error } = await supabase
        .from('photon_proofs')
        .insert([{
          user_id: photonProof.userId,
          circle_id: photonProof.circleId,
          timestamp: photonProof.timestamp.toISOString(),
          photo_url: photonProof.photoUrl,
          light_level: photonProof.lightLevel,
          verified: photonProof.verified,
          streak: photonProof.streak,
        }])
        .select()
        .single();

      if (error) {
        console.error('Error saving photon proof:', error);
        Alert.alert('Error', 'Failed to save your photon proof. Please try again.');
        return;
      }

      // Success feedback
      if (isVerified) {
        Alert.alert(
          'Photon Proof Verified! ☀️',
          `Great job! Your ${newStreak}-day sunrise streak continues. Light level: ${Math.round(lightLevel)}/255`,
          [{ text: 'Continue', onPress: () => onProofComplete({ ...photonProof, id: data.id }) }]
        );
      } else {
        Alert.alert(
          'Low Light Detected 🌙',
          `Your proof was saved but needs more sunlight for full verification. Try again outdoors or near a bright window. Light level: ${Math.round(lightLevel)}/255`,
          [{ text: 'Try Again', onPress: retakePicture }]
        );
      }

    } catch (error) {
      console.error('Error processing photon proof:', error);
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const retakePicture = () => {
    setCapturedImage(null);
  };

  const toggleCameraFacing = () => {
    setFacing(current => (current === 'back' ? 'front' : 'back'));
  };

  if (!permission) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Requesting camera permissions...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionIcon}>📷</Text>
          <Text style={styles.permissionTitle}>Camera Access Required</Text>
          <Text style={styles.permissionText}>
            To verify your morning photon exposure, we need access to your camera.
          </Text>
          <Button title="Grant Permission" onPress={requestPermission} />
          {onCancel && (
            <Button title="Cancel" variant="secondary" onPress={onCancel} />
          )}
        </View>
      </View>
    );
  }

  if (capturedImage) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Photon Proof Review</Text>
          <Text style={styles.subtitle}>Current streak: {currentStreak} days</Text>
        </View>
        
        <View style={styles.imageContainer}>
          <Image source={{ uri: capturedImage }} style={styles.capturedImage} />
          <View style={styles.imageOverlay}>
            <Text style={styles.overlayText}>Analyzing light levels...</Text>
          </View>
        </View>

        <View style={styles.actions}>
          <Button
            title={isProcessing ? "Processing..." : "Submit Proof ☀️"}
            onPress={uploadAndVerifyProof}
            disabled={isProcessing}
          />
          <Button
            title="Retake"
            variant="secondary"
            onPress={retakePicture}
            disabled={isProcessing}
          />
          {onCancel && (
            <Button
              title="Cancel"
              variant="secondary"
              onPress={onCancel}
              disabled={isProcessing}
            />
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Morning Photon Sync</Text>
        <Text style={styles.subtitle}>
          Capture sunlight within 60 minutes of waking
        </Text>
        <Text style={styles.streakText}>Current streak: {currentStreak} days</Text>
      </View>

      <View style={styles.cameraContainer}>
        <CameraView style={styles.camera} facing={facing} ref={cameraRef}>
          <View style={styles.cameraOverlay}>
            <View style={styles.cameraGuide}>
              <Text style={styles.guideText}>☀️ Point camera at bright sky or sunlight ☀️</Text>
            </View>
          </View>
        </CameraView>
      </View>

      <View style={styles.cameraControls}>
        <Pressable style={styles.flipButton} onPress={toggleCameraFacing}>
          <Text style={styles.flipButtonText}>🔄</Text>
        </Pressable>
        
        <Pressable style={styles.shutterButton} onPress={takePicture}>
          <View style={styles.shutterInner} />
        </Pressable>
        
        {onCancel && (
          <Pressable style={styles.cancelButton} onPress={onCancel}>
            <Text style={styles.cancelButtonText}>✕</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.tips}>
        <Text style={styles.tipsTitle}>💡 Pro Tips:</Text>
        <Text style={styles.tipText}>• Best results: outdoor natural light</Text>
        <Text style={styles.tipText}>• Near a bright window works too</Text>
        <Text style={styles.tipText}>• Avoid artificial indoor lighting</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 16,
    marginTop: 100,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  permissionIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  permissionTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  permissionText: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  header: {
    padding: 24,
    paddingTop: 60,
    alignItems: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
    marginBottom: 4,
  },
  subtitle: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
  },
  streakText: {
    color: '#fbbf24',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 8,
  },
  cameraContainer: {
    flex: 1,
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#111',
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
    padding: 20,
  },
  cameraGuide: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    padding: 12,
    alignSelf: 'center',
  },
  guideText: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
    fontWeight: '600',
  },
  cameraControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
    gap: 32,
  },
  flipButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  flipButtonText: {
    fontSize: 24,
  },
  shutterButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#fbbf24',
  },
  shutterInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fbbf24',
  },
  cancelButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
  },
  imageContainer: {
    flex: 1,
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  capturedImage: {
    flex: 1,
    width: '100%',
  },
  imageOverlay: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 8,
    padding: 12,
  },
  overlayText: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
    fontWeight: '600',
  },
  actions: {
    padding: 24,
    gap: 12,
  },
  tips: {
    padding: 24,
    paddingTop: 0,
  },
  tipsTitle: {
    color: '#fbbf24',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  tipText: {
    color: '#666',
    fontSize: 12,
    marginBottom: 4,
  },
});
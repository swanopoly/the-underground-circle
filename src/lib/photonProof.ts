import { supabase } from './supabase';
import { awardXP, getXPForAction } from './gamification';
import { PhotonProof } from '../types';

// Validation constants
const PEAK_HOURS = {
  MORNING: { start: 6, end: 10 }, // 6-10 AM
  EVENING: { start: 16, end: 20 }, // 4-8 PM
};

const LIGHT_THRESHOLDS = {
  MINIMUM: 100,    // Below this = invalid
  GOOD: 150,       // Good quality light
  EXCELLENT: 200,  // Excellent outdoor light
};

export interface PhotonProofRequest {
  circleId: string;
  photoBase64?: string;
  photoUri: string;
  timestamp: string;
  gpsLocation?: { lat: number; lng: number };
  lightLevel: number;
}

export interface PhotonValidationResult {
  isValid: boolean;
  score: number; // 0-100
  lightLevel: number;
  timingBonus: boolean;
  streakMultiplier: number;
  xpAwarded: number;
  reasons: string[];
}

/**
 * Advanced light level analysis from image metadata or processing
 * In production, this would use actual image processing libraries
 */
export function analyzeImageBrightness(imageUri: string): Promise<number> {
  return new Promise((resolve) => {
    // Mock implementation based on time of day and randomization
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    
    let baseLevel = 0;
    let variance = 20;
    
    // Time-based brightness estimation
    if (hour >= 6 && hour <= 9) {
      // Morning golden hour
      baseLevel = 180 + (hour - 6) * 15;
      variance = 30;
    } else if (hour >= 10 && hour <= 15) {
      // Midday bright
      baseLevel = 220;
      variance = 25;
    } else if (hour >= 16 && hour <= 19) {
      // Evening golden hour
      baseLevel = 170 - (hour - 16) * 20;
      variance = 35;
    } else {
      // Night/early morning/late evening
      baseLevel = 40 + Math.sin((hour - 6) * Math.PI / 12) * 30;
      variance = 40;
    }
    
    // Add realistic randomization
    const lightLevel = Math.max(0, Math.min(255, 
      baseLevel + (Math.random() - 0.5) * variance
    ));
    
    // Simulate processing delay
    setTimeout(() => resolve(lightLevel), 500);
  });
}

/**
 * Check if current time is within peak hours for photon capture
 */
export function isWithinPeakHours(): { valid: boolean; window: string; bonus: boolean } {
  const now = new Date();
  const hour = now.getHours();
  
  const inMorning = hour >= PEAK_HOURS.MORNING.start && hour < PEAK_HOURS.MORNING.end;
  const inEvening = hour >= PEAK_HOURS.EVENING.start && hour < PEAK_HOURS.EVENING.end;
  
  if (inMorning) {
    return { valid: true, window: 'morning', bonus: true };
  } else if (inEvening) {
    return { valid: true, window: 'evening', bonus: true };
  } else {
    return { valid: false, window: 'off-peak', bonus: false };
  }
}

/**
 * Calculate streak multiplier based on consecutive days
 */
export function calculateStreakMultiplier(streak: number): number {
  if (streak <= 1) return 1.0;
  if (streak <= 7) return 1.2;
  if (streak <= 14) return 1.5;
  if (streak <= 30) return 1.8;
  if (streak <= 60) return 2.0;
  return 2.5; // 60+ day streaks get max multiplier
}

/**
 * Validate photon proof submission
 */
export async function validatePhotonProof(
  request: PhotonProofRequest,
  userId: string
): Promise<PhotonValidationResult> {
  const reasons: string[] = [];
  let score = 0;
  let xpBase = getXPForAction('photon_proof') || 50;
  
  // 1. Check timing
  const timing = isWithinPeakHours();
  if (timing.valid) {
    score += 30;
    reasons.push(`Peak ${timing.window} light capture (+30 pts)`);
  } else {
    score += 10;
    reasons.push(`Off-peak capture (+10 pts)`);
  }
  
  // 2. Validate light level
  const { lightLevel } = request;
  if (lightLevel >= LIGHT_THRESHOLDS.EXCELLENT) {
    score += 40;
    reasons.push(`Excellent light quality: ${Math.round(lightLevel)}/255 (+40 pts)`);
  } else if (lightLevel >= LIGHT_THRESHOLDS.GOOD) {
    score += 30;
    reasons.push(`Good light quality: ${Math.round(lightLevel)}/255 (+30 pts)`);
  } else if (lightLevel >= LIGHT_THRESHOLDS.MINIMUM) {
    score += 15;
    reasons.push(`Adequate light: ${Math.round(lightLevel)}/255 (+15 pts)`);
  } else {
    score = 0;
    reasons.push(`Insufficient light: ${Math.round(lightLevel)}/255 (Invalid)`);
    return {
      isValid: false,
      score,
      lightLevel,
      timingBonus: timing.bonus,
      streakMultiplier: 1.0,
      xpAwarded: 0,
      reasons
    };
  }
  
  // 3. Check for existing proof today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const { data: existingProof } = await supabase
    .from('photon_proofs')
    .select('*')
    .eq('user_id', userId)
    .eq('circle_id', request.circleId)
    .gte('timestamp', today.toISOString())
    .limit(1);
    
  if (existingProof && existingProof.length > 0) {
    reasons.push('Already submitted today (No XP)');
    return {
      isValid: false,
      score: 0,
      lightLevel,
      timingBonus: timing.bonus,
      streakMultiplier: 1.0,
      xpAwarded: 0,
      reasons
    };
  }
  
  // 4. Calculate streak
  const { data: recentProofs } = await supabase
    .from('photon_proofs')
    .select('timestamp, streak')
    .eq('user_id', userId)
    .eq('circle_id', request.circleId)
    .order('timestamp', { ascending: false })
    .limit(7); // Check last week
    
  let currentStreak = 1;
  if (recentProofs && recentProofs.length > 0) {
    // Check if yesterday had a proof
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    
    const yesterdayProof = recentProofs.find(p => {
      const proofDate = new Date(p.timestamp);
      proofDate.setHours(0, 0, 0, 0);
      return proofDate.getTime() === yesterday.getTime();
    });
    
    if (yesterdayProof) {
      currentStreak = (yesterdayProof.streak || 0) + 1;
    }
  }
  
  // 5. Calculate final score and XP
  const streakMultiplier = calculateStreakMultiplier(currentStreak);
  const streakBonus = Math.round((streakMultiplier - 1.0) * 100);
  
  if (streakBonus > 0) {
    reasons.push(`${currentStreak}-day streak bonus (+${streakBonus}% XP)`);
  }
  
  // Location bonus (if GPS provided)
  if (request.gpsLocation) {
    score += 10;
    reasons.push('GPS location verified (+10 pts)');
  }
  
  // Cap score at 100
  score = Math.min(100, score);
  
  // Calculate XP with multipliers
  const finalXP = Math.round(xpBase * streakMultiplier);
  
  return {
    isValid: true,
    score,
    lightLevel,
    timingBonus: timing.bonus,
    streakMultiplier,
    xpAwarded: finalXP,
    reasons
  };
}

/**
 * Submit and store photon proof
 */
export async function submitPhotonProof(
  request: PhotonProofRequest,
  userId: string
): Promise<{ success: boolean; proof?: PhotonProof; validation?: PhotonValidationResult; error?: string }> {
  try {
    // Validate the proof
    const validation = await validatePhotonProof(request, userId);
    
    if (!validation.isValid) {
      return { 
        success: false, 
        validation,
        error: validation.reasons.join(', ')
      };
    }
    
    // Calculate streak from validation
    const { data: lastProof } = await supabase
      .from('photon_proofs')
      .select('streak')
      .eq('user_id', userId)
      .eq('circle_id', request.circleId)
      .order('timestamp', { ascending: false })
      .limit(1);
      
    const newStreak = validation.streakMultiplier > 1.0 ? 
      Math.round(((lastProof?.[0]?.streak || 0) + 1)) : 1;
    
    // Store the proof
    const { data, error } = await supabase
      .from('photon_proofs')
      .insert({
        user_id: userId,
        circle_id: request.circleId,
        timestamp: new Date().toISOString(),
        photo_url: request.photoUri,
        light_level: Math.round(request.lightLevel),
        verified: validation.score >= 60, // 60+ score = verified
        streak: newStreak,
        latitude: request.gpsLocation?.lat,
        longitude: request.gpsLocation?.lng,
      })
      .select()
      .single();
      
    if (error) {
      console.error('Error storing photon proof:', error);
      return { success: false, error: 'Failed to store proof' };
    }
    
    // Award XP
    if (validation.xpAwarded > 0) {
      await awardXP(userId, validation.xpAwarded, 'photon_proof', {
        circle_id: request.circleId,
        light_level: validation.lightLevel,
        score: validation.score,
        streak: newStreak
      });
    }
    
    // Check for streak achievements
    if (newStreak >= 7) {
      // Award streak achievement XP
      await awardXP(userId, 25, 'streak_milestone', {
        streak: newStreak,
        circle_id: request.circleId
      });
    }
    
    return { 
      success: true, 
      proof: {
        id: data.id,
        userId,
        circleId: request.circleId,
        timestamp: new Date(data.timestamp),
        photoUrl: data.photo_url,
        lightLevel: data.light_level,
        verified: data.verified,
        streak: data.streak,
        latitude: data.latitude,
        longitude: data.longitude,
      },
      validation 
    };
    
  } catch (error) {
    console.error('Error in submitPhotonProof:', error);
    return { success: false, error: 'Unexpected error occurred' };
  }
}

/**
 * Get user's photon proof history
 */
export async function getUserPhotonHistory(
  userId: string, 
  circleId?: string,
  limit: number = 30
): Promise<PhotonProof[]> {
  let query = supabase
    .from('photon_proofs')
    .select('*')
    .eq('user_id', userId)
    .order('timestamp', { ascending: false })
    .limit(limit);
    
  if (circleId) {
    query = query.eq('circle_id', circleId);
  }
  
  const { data, error } = await query;
  
  if (error) {
    console.error('Error fetching photon history:', error);
    return [];
  }
  
  return (data || []).map(d => ({
    id: d.id,
    userId: d.user_id,
    circleId: d.circle_id,
    timestamp: new Date(d.timestamp),
    photoUrl: d.photo_url,
    lightLevel: d.light_level,
    verified: d.verified,
    streak: d.streak,
    latitude: d.latitude,
    longitude: d.longitude,
  }));
}

/**
 * Get circle's top photon performers
 */
export async function getCirclePhotonLeaderboard(
  circleId: string,
  limit: number = 10
): Promise<Array<{
  userId: string;
  username: string;
  displayName: string;
  currentStreak: number;
  totalProofs: number;
  averageScore: number;
  lastProof?: Date;
}>> {
  // Get all photon proofs for this circle
  const { data: proofs } = await supabase
    .from('photon_proofs')
    .select('user_id, light_level, verified, streak, timestamp')
    .eq('circle_id', circleId)
    .order('timestamp', { ascending: false })
    .limit(500);
    
  if (!proofs?.length) return [];
  
  // Group by user
  const userStats = new Map();
  
  for (const proof of proofs) {
    const stats = userStats.get(proof.user_id) || {
      userId: proof.user_id,
      totalProofs: 0,
      totalScore: 0,
      currentStreak: 0,
      lastProof: null,
    };
    
    stats.totalProofs++;
    stats.totalScore += proof.light_level;
    stats.currentStreak = Math.max(stats.currentStreak, proof.streak || 0);
    
    if (!stats.lastProof || new Date(proof.timestamp) > stats.lastProof) {
      stats.lastProof = new Date(proof.timestamp);
    }
    
    userStats.set(proof.user_id, stats);
  }
  
  // Get user profiles
  const userIds = Array.from(userStats.keys());
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, display_name')
    .in('id', userIds);
    
  const profileMap = new Map((profiles || []).map(p => [p.id, p]));
  
  // Convert to leaderboard format
  const leaderboard = Array.from(userStats.values()).map(stats => {
    const profile = profileMap.get(stats.userId);
    return {
      userId: stats.userId,
      username: profile?.username || 'Unknown',
      displayName: profile?.display_name || 'Unknown',
      currentStreak: stats.currentStreak,
      totalProofs: stats.totalProofs,
      averageScore: Math.round(stats.totalScore / stats.totalProofs),
      lastProof: stats.lastProof,
    };
  });
  
  // Sort by current streak (primary) then total proofs (secondary)
  leaderboard.sort((a, b) => {
    if (b.currentStreak !== a.currentStreak) {
      return b.currentStreak - a.currentStreak;
    }
    return b.totalProofs - a.totalProofs;
  });
  
  return leaderboard.slice(0, limit);
}
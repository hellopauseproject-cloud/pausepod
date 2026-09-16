import { Image } from 'react-native';
import type { PauseSession } from '../types/database';

// Fiktiva vänner för att demonstrera gemenskaps-funktionen utan riktiga konton.
// Rör aldrig Supabase — allt hålls lokalt och läggs bara till vid rendering.

export type DemoFriend = {
  id: string;
  username: string;
  avatar_url: string | null;
  show_stats: boolean;
  is_pausing: boolean;
  friendshipId: string;
};

export type DemoStory = {
  id: string;
  user_id: string;
  support_type: string;
  activity: string;
  intention_id: string | null;
  personal_note: string | null;
  created_at: string;
  profile: { id: string; username: string; avatar_url: string | null } | null;
};

export type DemoWrappedData = {
  sessionCount: number;
  totalMinutes: number;
  avgMinutes: number;
  topIntention: string | null;
  topIntentionEmoji: string | null;
  friendInsight: string | null;
  avatarUrl: string | null;
  sharedPauseCount: number;
  bestBuddy: { username: string; avatarUrl: string | null } | null;
};

const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 60 * 60 * 1000).toISOString();

// Image.resolveAssetSource ger en URI-sträng ur en require(), så samma
// avatar_url: string-typ som riktiga profiler kan återanvändas överallt.
const PETRA_AVATAR = Image.resolveAssetSource(require('../assets/images/Petra.png')).uri;
const NOAH_AVATAR = Image.resolveAssetSource(require('../assets/images/Noah.png')).uri;
const SAGA_AVATAR = Image.resolveAssetSource(require('../assets/images/Saga.png')).uri;

export const DEMO_FRIEND_IDS = ['demo-petra', 'demo-noah', 'demo-saga'] as const;
const DEMO_STORY_IDS = ['demo-story-petra', 'demo-story-noah', 'demo-story-saga'] as const;

export function isDemoId(id: string | null | undefined): boolean {
  return !!id && (DEMO_FRIEND_IDS as readonly string[]).includes(id);
}

export function isDemoStoryId(id: string | null | undefined): boolean {
  return !!id && (DEMO_STORY_IDS as readonly string[]).includes(id);
}

export const DEMO_FRIENDS: DemoFriend[] = [
  { id: 'demo-petra', username: 'Petra', avatar_url: PETRA_AVATAR, show_stats: true, is_pausing: false, friendshipId: 'demo-friendship-petra' },
  { id: 'demo-noah', username: 'Noah', avatar_url: NOAH_AVATAR, show_stats: true, is_pausing: true, friendshipId: 'demo-friendship-noah' },
  { id: 'demo-saga', username: 'Saga', avatar_url: SAGA_AVATAR, show_stats: true, is_pausing: false, friendshipId: 'demo-friendship-saga' },
];

export const DEMO_STORIES: DemoStory[] = [
  {
    id: 'demo-story-petra',
    user_id: 'demo-petra',
    support_type: 'pepp,sällskap',
    activity: 'promenera',
    intention_id: 'walk',
    personal_note: 'Behöver pusha mig ut idag ☀️',
    created_at: hoursAgo(2),
    profile: { id: 'demo-petra', username: 'Petra', avatar_url: PETRA_AVATAR },
  },
  {
    id: 'demo-story-noah',
    user_id: 'demo-noah',
    support_type: 'en knuff,motivationstal',
    activity: 'plugga inför tentan',
    intention_id: 'study',
    personal_note: 'Prokrastinerar, hjälp 😅',
    created_at: hoursAgo(5),
    profile: { id: 'demo-noah', username: 'Noah', avatar_url: NOAH_AVATAR },
  },
  {
    id: 'demo-story-saga',
    user_id: 'demo-saga',
    support_type: 'lugn,närvaro',
    activity: 'meditera',
    intention_id: 'meditate',
    personal_note: null,
    created_at: hoursAgo(8),
    profile: { id: 'demo-saga', username: 'Saga', avatar_url: SAGA_AVATAR },
  },
];

export const DEMO_SESSION_MAP: Record<string, { active: PauseSession | null; latest: PauseSession | null }> = {
  'demo-petra': {
    active: null,
    latest: {
      id: 'demo-session-petra', user_id: 'demo-petra',
      started_at: hoursAgo(2.6), ended_at: hoursAgo(2.3),
      duration_seconds: 18 * 60, intention: 'PROMENAD',
      is_shared: false, shared_session_id: null, invite_status: null,
      with_pod: false, completed: true, box_id: null, box_seq: null,
    },
  },
  'demo-saga': {
    active: null,
    latest: {
      id: 'demo-session-saga', user_id: 'demo-saga',
      started_at: hoursAgo(3.3), ended_at: hoursAgo(3),
      duration_seconds: 22 * 60, intention: 'MEDITATION',
      is_shared: false, shared_session_id: null, invite_status: null,
      with_pod: false, completed: true, box_id: null, box_seq: null,
    },
  },
};

export const DEMO_WRAPPED: Record<string, DemoWrappedData> = {
  'demo-petra': {
    sessionCount: 6, totalMinutes: 145, avgMinutes: 145 / 6,
    topIntention: 'PROMENAD', topIntentionEmoji: '🚶',
    friendInsight: 'Små promenader har blivit min bästa återhämtning den här veckan.',
    avatarUrl: PETRA_AVATAR, sharedPauseCount: 4, bestBuddy: null,
  },
  'demo-noah': {
    sessionCount: 12, totalMinutes: 560, avgMinutes: 560 / 12,
    topIntention: 'STUDIER', topIntentionEmoji: '✏️',
    friendInsight: 'Fokus kommer och går, men varje paus hjälper mig komma tillbaka.',
    avatarUrl: NOAH_AVATAR, sharedPauseCount: 2, bestBuddy: null,
  },
  'demo-saga': {
    sessionCount: 8, totalMinutes: 210, avgMinutes: 210 / 8,
    topIntention: 'MEDITATION', topIntentionEmoji: '🧘',
    friendInsight: 'Så härligt med meditation, jag bara måste sluta scrolla för att hitta dit.',
    avatarUrl: SAGA_AVATAR, sharedPauseCount: 1, bestBuddy: null,
  },
};

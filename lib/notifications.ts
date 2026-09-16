import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export const BLOCKS_STORAGE_PATH = 'selectedBlocks.json';

export const TIME_BLOCKS = [
  { id: 'morning',       label: '🌅 Morgon',      time: '07:00-09:00', hour: 7  },
  { id: 'forenoon',      label: '☕ Förmiddag',   time: '09:00-12:00', hour: 9  },
  { id: 'lunch',         label: '🌞 Lunch',        time: '12:00-14:00', hour: 12 },
  { id: 'afternoon',     label: '🌤 Eftermiddag',  time: '14:00-17:00', hour: 14 },
  { id: 'early_evening', label: '🌆 Tidig kväll',  time: '17:00-19:00', hour: 17 },
  { id: 'evening',       label: '🌙 Kväll',        time: '19:00-21:00', hour: 19 },
  { id: 'late_evening',  label: '🌚 Sen kväll',    time: '21:00-23:00', hour: 21 },
  { id: 'night',         label: '🌑 Natt',          time: '00:00-07:00', hour: 2  },
];

// iOS allows max 64 local notifications. Keep total under 60 to be safe.
const MAX_NOTIFICATIONS = 60;
const SCHEDULE_DAYS = 30;

// Reschedule when fewer than this many remain.
export const RESCHEDULE_THRESHOLD = 15;

export async function scheduleBlockNotifications(callerName: string, selectedBlockIds: string[]) {
  const blocks = TIME_BLOCKS.filter(b => selectedBlockIds.includes(b.id));
  if (blocks.length === 0) return;

  await Notifications.cancelAllScheduledNotificationsAsync();

  const days = Math.min(SCHEDULE_DAYS, Math.floor(MAX_NOTIFICATIONS / blocks.length));
  const now = new Date();

  for (let day = 0; day < days; day++) {
    for (const block of blocks) {
      const type = Math.random() < 0.5 ? 'call' : 'text-message';
      const date = new Date();
      date.setDate(now.getDate() + day);
      date.setHours(block.hour, Math.floor(Math.random() * 60), 0, 0);
      if (date <= now) continue;

      const title = type === 'call'
        ? `${callerName} ringer...`
        : `SMS från ${callerName}...`;
      const body = type === 'call'
        ? 'Klicka för att svara'
        : 'Klicka för att läsa';

      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          sound: type === 'call' ? 'ringtone.wav' : 'default',
          data: { screen: type },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date,
          channelId: 'incoming-call',
        },
      });
    }
  }
}

export async function setupNotificationChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Default',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#2e86de',
  });
}

export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  await setupNotificationChannel();

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.warn('[Notifications] Permission not granted:', finalStatus);
    return null;
  }

  try {
    const token = await Notifications.getExpoPushTokenAsync({
      projectId: '8ea26c15-1ed7-4200-94de-3628f5935cfc',
    });
    console.log('[Notifications] Push token registered:', token.data);
    return token.data;
  } catch (e) {
    console.error('[Notifications] Failed to get push token:', e);
    return null;
  }
}

export async function sendPushNotification(
  expoPushToken: string,
  title: string,
  body: string,
  data?: Record<string, string>
) {
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: expoPushToken, title, body, data, sound: 'default', priority: 'high', channelId: 'default' }),
    });
    const json = await res.json();
    if (json?.data?.status === 'error') {
      console.error('[Notifications] Push send error:', json.data.message);
    } else {
      console.log('[Notifications] Push sent OK');
    }
  } catch (e) {
    console.error('[Notifications] Fetch error:', e);
  }
}

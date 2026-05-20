import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { BLEProvider, useBLEControl } from '../context/BLEContext';

export const unstable_settings = {
  anchor: '(tabs)',
};

function InnerLayout() {
  const colorScheme = useColorScheme();
  const { connectToPausePod } = useBLEControl();

  useEffect(() => {
    connectToPausePod();
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="call" options={{ headerShown: false }} />
        <Stack.Screen name="voice" options={{ headerShown: false }} />
        <Stack.Screen name="video" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding-flow" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding-complete" options={{ headerShown: false }} />
        <Stack.Screen name="pause" options={{ headerShown: false }} />
        <Stack.Screen name="pauseLogger" options={{ headerShown: false }} />
        <Stack.Screen name="pausesummary" options={{ headerShown: false }} />
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="pausing" options={{ headerShown: false }} />
        <Stack.Screen name="placeinbox" options={{ headerShown: false, animation: 'none', freezeOnBlur: true }} />
        <Stack.Screen name="stats" options={{ headerShown: false }} />
        <Stack.Screen name="profile" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <BLEProvider>
      <InnerLayout />
    </BLEProvider>
  );
}

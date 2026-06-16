import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CloudStatusProvider } from '../context/CloudStatusContext';
import { configureAudioSession } from '../utils/tts';

export default function Layout() {
  useEffect(() => {
    // Audio-Session einmalig einrichten, damit die Wiedergabe bei gesperrtem
    // Bildschirm nicht abbricht.
    configureAudioSession();
  }, []);

  return (
    <SafeAreaProvider>
      <CloudStatusProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#fff' },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="stats" />
      </Stack>
      </CloudStatusProvider>
    </SafeAreaProvider>
  );
}

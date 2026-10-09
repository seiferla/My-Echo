import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CloudStatusProvider } from '../context/CloudStatusContext';
import { PhrasesProvider } from '../context/PhrasesContext';
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
      <PhrasesProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#fff' },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="stats" />
        <Stack.Screen name="phrases" />
      </Stack>
      </PhrasesProvider>
      </CloudStatusProvider>
    </SafeAreaProvider>
  );
}

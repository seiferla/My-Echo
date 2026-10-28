import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { CloudStatusProvider } from '../context/CloudStatusContext';
import { PhrasesProvider } from '../context/PhrasesContext';
import { configureAudioSession } from '../utils/audioPlayer';

// Route guard: signed out only "login" is reachable, signed in only the app screens.
function RootStack() {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }}>
        <ActivityIndicator size="large" accessibilityLabel="Wird geladen" />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#fff' },
      }}
    >
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="index" />
        <Stack.Screen name="stats" />
        <Stack.Screen name="phrases" />
        <Stack.Screen name="voice" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}

// A new key on account change remounts the provider, so it loads the new account's data.
function UserScope({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  return (
    <PhrasesProvider key={session?.user.id ?? 'signed-out'}>{children}</PhrasesProvider>
  );
}

export default function Layout() {
  useEffect(() => {
    // Set up the audio session once, so playback goes on when the screen is locked.
    configureAudioSession();
  }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
      <CloudStatusProvider>
      <UserScope>
      <RootStack />
      </UserScope>
      </CloudStatusProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { CloudStatusProvider } from '../context/CloudStatusContext';
import { PhrasesProvider } from '../context/PhrasesContext';
import { configureAudioSession } from '../utils/tts';

// Route-Guard: ohne Session ist nur "login" erreichbar, mit Session nur die
// App-Screens. Nach Login/Logout wechselt expo-router automatisch.
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
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}

// Alles, was nutzerbezogene Daten im Speicher hält, wird beim Kontowechsel neu
// aufgebaut (neuer key → neuer Provider → liest die Daten des neuen Kontos).
function UserScope({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  return (
    <PhrasesProvider key={session?.user.id ?? 'signed-out'}>{children}</PhrasesProvider>
  );
}

export default function Layout() {
  useEffect(() => {
    // Audio-Session einmalig einrichten, damit die Wiedergabe bei gesperrtem
    // Bildschirm nicht abbricht.
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

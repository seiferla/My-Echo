import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CloudStatusProvider } from '../context/CloudStatusContext';

export default function Layout() {
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

import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './navigation/RootNavigator';
import { AppProviders } from './providers/AppProviders';

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProviders>
        <RootNavigator />
      </AppProviders>
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}

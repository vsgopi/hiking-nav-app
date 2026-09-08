import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

export function LoadingView({ label }: { label: string }) {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#2f6f4f" />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  label: { marginTop: 12, fontSize: 15, color: '#333' },
});

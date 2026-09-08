import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export function ErrorView({ message, detail }: { message: string; detail?: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  message: { fontSize: 16, fontWeight: '700', color: '#c0392b', textAlign: 'center' },
  detail: { marginTop: 8, fontSize: 13, color: '#666', textAlign: 'center' },
});

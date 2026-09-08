import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface Props {
  /** The trail actually being navigated (e.g. a single section like "Northern Walkway"). */
  title: string;
  /** Context for the bold title — e.g. the parent multi-region trail's name. */
  subtitle: string;
}

export function TrailInfoPanel({ title, subtitle }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.trailName}>{title}</Text>
      <Text style={styles.sectionName}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  trailName: { fontSize: 18, fontWeight: '700' },
  sectionName: { fontSize: 14, color: '#444', marginTop: 2 },
});

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface Props {
  completionPercentage: number;
  distanceAlongTrailKm: number;
  distanceRemainingKm: number;
}

export function ProgressBar({ completionPercentage, distanceAlongTrailKm, distanceRemainingKm }: Props) {
  const totalKm = distanceAlongTrailKm + distanceRemainingKm;

  return (
    <View style={styles.container}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${completionPercentage}%` }]} />
      </View>
      <Text style={styles.label}>
        {distanceAlongTrailKm.toFixed(2)}km / {totalKm.toFixed(2)}km · {completionPercentage.toFixed(0)}%
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 8,
    padding: 10,
  },
  track: {
    height: 8,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: '#2f6f4f',
  },
  label: {
    marginTop: 6,
    fontSize: 13,
    color: '#333',
  },
});

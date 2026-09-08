import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatDistanceFromTrail } from '../../../shared/utils/formatDistance';

interface Props {
  distanceMeters: number;
  trailName: string;
}

/**
 * Shown while the hiker has wandered off the trail but is still close enough
 * that the camera keeps following them (see TRAIL_RELEVANCE_THRESHOLD_METERS)
 * — a live, moderate-distance warning, not the neutral far-away state.
 */
export function OffTrailBadge({ distanceMeters, trailName }: Props) {
  return (
    <View style={styles.badge}>
      <Text style={styles.text}>
        Off trail · {formatDistanceFromTrail(distanceMeters)} from {trailName}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    marginTop: 8,
    backgroundColor: '#c0392b',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  text: { color: '#fff', fontWeight: '700' },
});

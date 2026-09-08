import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatDistanceFromTrail } from '../../../shared/utils/formatDistance';
import { MapActionButton } from '../../map/components/MapActionButton';

interface Props {
  distanceMeters: number;
  trailName: string;
  isShowingActualLocation: boolean;
  onToggleShowActualLocation: () => void;
}

/**
 * Shown instead of OffTrailBadge when the GPS fix is nowhere near this trail
 * at all (e.g. a simulator's default location, or a phone at home before the
 * hike). A neutral "here's the trail, and here's how far you are" state —
 * the map keeps showing the trail itself (CameraController's `userOffTrail`
 * mode), never an alarming, meaningless off-trail distance.
 */
export function TrailOverviewBadge({
  distanceMeters,
  trailName,
  isShowingActualLocation,
  onToggleShowActualLocation,
}: Props) {
  return (
    <View style={styles.badge}>
      <Text style={styles.text}>
        GPS location is {formatDistanceFromTrail(distanceMeters)} from {trailName}
      </Text>
      <View style={styles.action}>
        <MapActionButton
          label={isShowingActualLocation ? 'Show Trail' : 'Show my location'}
          onPress={onToggleShowActualLocation}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    marginTop: 8,
    backgroundColor: '#546e7a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  text: { color: '#fff', fontWeight: '700' },
  action: { marginTop: 8, alignSelf: 'flex-start' },
});

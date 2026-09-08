import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker } from '../../../core/maps/MapProvider';
import type { GeoPosition } from '../../../domain/usecases/NavigationEngine.types';

interface Props {
  position: GeoPosition;
  isOffTrail: boolean;
}

export function UserLocationMarker({ position, isOffTrail }: Props) {
  return (
    <Marker id="userLocation" lngLat={[position.longitude, position.latitude]}>
      <View style={[styles.dot, isOffTrail ? styles.dotOffTrail : styles.dotOnTrail]} />
    </Marker>
  );
}

const styles = StyleSheet.create({
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: '#ffffff',
  },
  dotOnTrail: { backgroundColor: '#2f6f4f' },
  dotOffTrail: { backgroundColor: '#c0392b' },
});

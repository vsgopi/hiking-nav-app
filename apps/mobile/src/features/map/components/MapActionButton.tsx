import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

interface Props {
  label: string;
  onPress: () => void;
  variant?: 'default' | 'primary';
}

/** Pill button used for map camera actions: Overview, Re-center, Show my location. */
export function MapActionButton({ label, onPress, variant = 'default' }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        pressed && styles.buttonPressed,
      ]}
    >
      <Text style={[styles.label, variant === 'primary' && styles.labelPrimary]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 2,
  },
  buttonPrimary: {
    backgroundColor: '#2f6f4f',
  },
  buttonPressed: {
    opacity: 0.75,
  },
  label: {
    color: '#1a1a1a',
    fontWeight: '700',
    fontSize: 13,
  },
  labelPrimary: {
    color: '#ffffff',
  },
});

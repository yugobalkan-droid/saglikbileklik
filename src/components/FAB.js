import React from 'react';
import { StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, borderRadius, shadows } from '../theme';
import AnimatedButton from './AnimatedButton';

export default function FAB({ onPress, icon = 'add', size = 56 }) {
  return (
    <AnimatedButton
      style={[styles.fab, { width: size, height: size, borderRadius: size / 2 }]}
      onPress={onPress}
      activeOpacity={0.6}
    >
      <Ionicons name={icon} size={28} color={colors.textOnPrimary} />
    </AnimatedButton>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.xl,
    zIndex: 10,
  },
});

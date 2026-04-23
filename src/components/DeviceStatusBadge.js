import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius } from '../theme';

export default function DeviceStatusBadge({ label, status, icon, batteryLevel }) {
  const isOnline = status === 'online' || status === 'taken';
  const isBattery = !!batteryLevel;

  return (
    <View style={styles.badge}>
      <View style={[styles.dot, { backgroundColor: isOnline ? colors.online : colors.offline }]} />
      <Ionicons
        name={icon || 'hardware-chip-outline'}
        size={14}
        color={colors.textSecondary}
        style={{ marginRight: 4 }}
      />
      <Text style={styles.label}>{label}</Text>
      {isBattery ? (
        <View style={styles.batteryContainer}>
          <Ionicons name="battery-half-outline" size={14} color={colors.battery} />
          <Text style={[styles.value, { color: colors.battery }]}>{batteryLevel}%</Text>
        </View>
      ) : (
        <Text style={[styles.value, { color: isOnline ? colors.online : colors.offline }]}>
          {isOnline ? 'Çevrimiçi' : 'Çevrimdışı'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceVariant,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    marginRight: spacing.sm,
    marginBottom: spacing.xs,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: spacing.xs,
  },
  label: {
    ...typography.labelSmall,
    color: colors.textSecondary,
    marginRight: spacing.xs,
  },
  value: {
    ...typography.labelSmall,
    fontWeight: '600',
  },
  batteryContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
});

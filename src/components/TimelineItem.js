import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';

export default function TimelineItem({ time, title, medications, status, isNext }) {
  const getStatusConfig = () => {
    switch (status) {
      case 'completed':
        return {
          icon: 'checkmark-circle',
          iconColor: colors.success,
          bgColor: colors.successSurface,
          borderColor: colors.success,
          label: 'Alındı',
          labelColor: colors.success,
        };
      case 'missed':
        return {
          icon: 'close-circle',
          iconColor: colors.accent,
          bgColor: colors.accentSurface,
          borderColor: colors.accent,
          label: 'Kaçırıldı',
          labelColor: colors.accent,
        };
      case 'upcoming':
        return {
          icon: 'time-outline',
          iconColor: colors.primary,
          bgColor: isNext ? colors.primarySurface : colors.surfaceVariant,
          borderColor: isNext ? colors.primary : colors.border,
          label: isNext ? 'Sıradaki' : 'Beklemede',
          labelColor: isNext ? colors.primary : colors.textTertiary,
        };
      default:
        return {
          icon: 'ellipse-outline',
          iconColor: colors.textTertiary,
          bgColor: colors.surfaceVariant,
          borderColor: colors.border,
          label: 'Beklemede',
          labelColor: colors.textTertiary,
        };
    }
  };

  const config = getStatusConfig();

  return (
    <View style={[styles.container, isNext && styles.nextContainer]}>
      {/* Timeline line and dot */}
      <View style={styles.timelineTrack}>
        <View style={[styles.timelineDot, { backgroundColor: config.iconColor }]}>
          <Ionicons name={config.icon} size={20} color="#fff" />
        </View>
        <View style={styles.timelineLine} />
      </View>

      {/* Card */}
      <View style={[
        styles.card,
        { backgroundColor: config.bgColor, borderLeftColor: config.borderColor },
        isNext && shadows.md,
      ]}>
        <View style={styles.cardHeader}>
          <Text style={styles.time}>{time}</Text>
          <View style={[styles.statusBadge, { backgroundColor: config.labelColor + '18' }]}>
            <Text style={[styles.statusLabel, { color: config.labelColor }]}>{config.label}</Text>
          </View>
        </View>
        <Text style={styles.title}>{title}</Text>
        {medications && medications.map((med, index) => (
          <View key={index} style={styles.medRow}>
            <Ionicons name="medical-outline" size={14} color={config.iconColor} />
            <Text style={styles.medName}>{med.name}</Text>
            <Text style={styles.medDose}>{med.dose}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginBottom: spacing.md,
  },
  nextContainer: {
    transform: [{ scale: 1.02 }],
  },
  timelineTrack: {
    alignItems: 'center',
    width: 40,
    marginRight: spacing.md,
  },
  timelineDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  timelineLine: {
    flex: 1,
    width: 2,
    backgroundColor: colors.border,
    marginTop: -2,
  },
  card: {
    flex: 1,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    borderLeftWidth: 3,
    marginBottom: spacing.xs,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  time: {
    ...typography.titleMedium,
    color: colors.textPrimary,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  statusLabel: {
    ...typography.labelSmall,
    fontWeight: '600',
  },
  title: {
    ...typography.headlineSmall,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  medRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
    gap: spacing.sm,
  },
  medName: {
    ...typography.bodyMedium,
    color: colors.textPrimary,
    flex: 1,
  },
  medDose: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
});

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';

export default function MedicationCard({ compartment, medication, time, isNext, onPress }) {
  return (
    <TouchableOpacity
      style={[styles.card, isNext && styles.nextCard]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.iconContainer}>
        <View style={[styles.iconBg, isNext && styles.nextIconBg]}>
          <Ionicons
            name={isNext ? 'notifications' : 'medical'}
            size={24}
            color={isNext ? colors.textOnPrimary : colors.primary}
          />
        </View>
      </View>
      <View style={styles.content}>
        {isNext && (
          <Text style={styles.nextLabel}>SIRADAKİ İLAÇ</Text>
        )}
        <Text style={[styles.title, isNext && styles.nextTitle]}>
          {medication || 'Boş Bölme'}
        </Text>
        <View style={styles.detailRow}>
          <Ionicons name="time-outline" size={14} color={isNext ? colors.primaryLight : colors.textTertiary} />
          <Text style={[styles.detail, isNext && styles.nextDetail]}>{time}</Text>
          <Ionicons name="cube-outline" size={14} color={isNext ? colors.primaryLight : colors.textTertiary} />
          <Text style={[styles.detail, isNext && styles.nextDetail]}>Bölme {compartment}</Text>
        </View>
      </View>
      <Ionicons
        name="chevron-forward"
        size={20}
        color={isNext ? 'rgba(255,255,255,0.6)' : colors.textTertiary}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    ...shadows.md,
    marginBottom: spacing.md,
  },
  nextCard: {
    backgroundColor: colors.primary,
    ...shadows.lg,
  },
  iconContainer: {
    marginRight: spacing.lg,
  },
  iconBg: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primarySurface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nextIconBg: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  content: {
    flex: 1,
  },
  nextLabel: {
    ...typography.labelSmall,
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 1,
    marginBottom: 2,
  },
  title: {
    ...typography.titleLarge,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  nextTitle: {
    color: colors.textOnPrimary,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  detail: {
    ...typography.bodySmall,
    color: colors.textTertiary,
    marginRight: spacing.sm,
  },
  nextDetail: {
    color: 'rgba(255,255,255,0.7)',
  },
});

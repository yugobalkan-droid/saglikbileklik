import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Dimensions,
  Linking,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function AlertOverlay({ visible, onClose, patientName, medication, compartment, time, onResolve }) {
  if (!visible) return null;

  const handleCall = () => {
    // Telefon uygulamasını aç
    Linking.openURL('tel:').catch(() => {});
  };

  const handleResend = () => {
    // Hatırlatıcıyı tekrar gönder
    if (onResolve) onResolve();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Alert Icon */}
          <View style={styles.iconContainer}>
            <View style={styles.iconPulseOuter} />
            <View style={styles.iconPulseInner} />
            <View style={styles.iconBg}>
              <Ionicons name="alert" size={36} color={colors.textOnAccent} />
            </View>
          </View>

          {/* Alert Content */}
          <Text style={styles.alertTitle}>İlaç Alınmadı!</Text>
          <Text style={styles.alertSubtitle}>
            {patientName || 'Hasta'}, belirlenen süre içinde ilacını almadı.
          </Text>

          {/* Medication Info */}
          <View style={styles.medInfo}>
            <View style={styles.medInfoRow}>
              <Ionicons name="medical-outline" size={18} color={colors.accent} />
              <Text style={styles.medInfoLabel}>İlaç:</Text>
              <Text style={styles.medInfoValue}>{medication || 'Aspirin 100mg'}</Text>
            </View>
            <View style={styles.medInfoRow}>
              <Ionicons name="cube-outline" size={18} color={colors.accent} />
              <Text style={styles.medInfoLabel}>Bölme:</Text>
              <Text style={styles.medInfoValue}>{compartment || 'Bölme 2'}</Text>
            </View>
            <View style={styles.medInfoRow}>
              <Ionicons name="time-outline" size={18} color={colors.accent} />
              <Text style={styles.medInfoLabel}>Planlanan:</Text>
              <Text style={styles.medInfoValue}>{time || '14:00'}</Text>
            </View>
            <View style={styles.medInfoRow}>
              <Ionicons name="hourglass-outline" size={18} color={colors.error} />
              <Text style={styles.medInfoLabel}>Gecikme:</Text>
              <Text style={[styles.medInfoValue, { color: colors.error }]}>30+ dakika</Text>
            </View>
          </View>

          {/* Action Buttons */}
          <Pressable style={styles.primaryBtn} onPress={handleCall}>
            <Ionicons name="call" size={20} color={colors.textOnPrimary} />
            <Text style={styles.primaryBtnText}>Hastayı Ara</Text>
          </Pressable>

          <Pressable style={styles.secondaryBtn} onPress={handleResend}>
            <Ionicons name="notifications" size={20} color={colors.primary} />
            <Text style={styles.secondaryBtnText}>Hatırlatıcıyı Tekrar Gönder</Text>
          </Pressable>

          <Pressable style={styles.tertiaryBtn} onPress={onClose}>
            <Ionicons name="volume-mute" size={20} color={colors.textSecondary} />
            <Text style={styles.tertiaryBtnText}>Sustur</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
  },
  card: {
    width: SCREEN_WIDTH - 48,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.xxl,
    alignItems: 'center',
    ...shadows.xl,
  },
  iconContainer: {
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  iconPulseOuter: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.accentSurface,
  },
  iconPulseInner: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.accentLight + '40',
  },
  iconBg: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  alertTitle: {
    ...typography.headlineLarge,
    color: colors.accent,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  alertSubtitle: {
    ...typography.bodyLarge,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: 22,
  },
  medInfo: {
    width: '100%',
    backgroundColor: colors.accentSurface,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    marginBottom: spacing.xxl,
  },
  medInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  medInfoLabel: {
    ...typography.bodyMedium,
    color: colors.textSecondary,
    width: 80,
  },
  medInfoValue: {
    ...typography.titleMedium,
    color: colors.textPrimary,
    flex: 1,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    width: '100%',
    paddingVertical: spacing.lg,
    borderRadius: borderRadius.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
    ...shadows.md,
  },
  primaryBtnText: {
    ...typography.titleMedium,
    color: colors.textOnAccent,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySurface,
    width: '100%',
    paddingVertical: spacing.lg,
    borderRadius: borderRadius.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  secondaryBtnText: {
    ...typography.titleMedium,
    color: colors.primary,
  },
  tertiaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  tertiaryBtnText: {
    ...typography.titleMedium,
    color: colors.textSecondary,
  },
});

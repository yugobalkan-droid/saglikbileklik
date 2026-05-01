import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';
import AlertOverlay from '../components/AlertOverlay';
import { usePatient } from '../context/PatientContext';
import { markAsRead, markAllAsRead, resolveAlert, deleteAllAlerts } from '../services/alertService';
import { Alert } from 'react-native';

const getNotificationIcon = (type) => {
  switch (type) {
    case 'missed':
      return { name: 'alert-circle', color: colors.accent, bg: colors.accentSurface };
    case 'taken':
      return { name: 'checkmark-circle', color: colors.success, bg: colors.successSurface };
    case 'device':
      return { name: 'hardware-chip', color: colors.warning, bg: colors.warningSurface };
    case 'reminder':
      return { name: 'notifications', color: colors.info, bg: colors.infoSurface };
    default:
      return { name: 'information-circle', color: colors.textTertiary, bg: colors.surfaceVariant };
  }
};

const formatTimestamp = (createdAt) => {
  if (!createdAt) return '';
  const date = createdAt?.toDate?.() || new Date(createdAt);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const hours = date.getHours().toString().padStart(2, '0');
  const mins = date.getMinutes().toString().padStart(2, '0');
  const time = `${hours}:${mins}`;

  if (isToday) return time;
  if (isYesterday) return `Dün ${time}`;
  return `${date.getDate()}.${(date.getMonth() + 1).toString().padStart(2, '0')} ${time}`;
};

const isToday = (createdAt) => {
  if (!createdAt) return false;
  const date = createdAt?.toDate?.() || new Date(createdAt);
  return date.toDateString() === new Date().toDateString();
};

export default function AlertsScreen() {
  const { alerts, unreadCount, patientId, patient } = usePatient();
  const [showAlert, setShowAlert] = useState(false);
  const [selectedNotif, setSelectedNotif] = useState(null);
  const [activeFilter, setActiveFilter] = useState('all');

  const handleNotifPress = async (notif) => {
    // Okundu olarak işaretle
    if (!notif.isRead) {
      try {
        await markAsRead(notif.id);
      } catch (e) {
        console.error('markAsRead error:', e);
      }
    }

    if (notif.type === 'missed') {
      setSelectedNotif(notif);
      setShowAlert(true);
    }
  };

  const handleMarkAllRead = async () => {
    if (!patientId) return;
    try {
      await markAllAsRead(patientId);
    } catch (e) {
      console.error('markAllAsRead error:', e);
    }
  };

  const handleDeleteAll = () => {
    Alert.alert(
      'Bildirimleri Sil',
      'Tüm bildirim geçmişini tamamen silmek istediğinize emin misiniz?',
      [
        { text: 'İptal', style: 'cancel' },
        { 
          text: 'Sil', 
          style: 'destructive', 
          onPress: async () => {
            if (!patientId) return;
            try {
              await deleteAllAlerts(patientId);
            } catch (e) {
              console.error('deleteAllAlerts error:', e);
            }
          }
        }
      ]
    );
  };

  const handleResolve = async () => {
    if (!selectedNotif) return;
    try {
      await resolveAlert(selectedNotif.id);
      setShowAlert(false);
      setSelectedNotif(null);
    } catch (e) {
      console.error('resolveAlert error:', e);
    }
  };

  // Filtre uygula
  const filteredAlerts = alerts.filter((a) => {
    if (activeFilter === 'all') return true;
    return a.type === activeFilter;
  });

  // Bugün / Daha eski olarak grupla
  const todayAlerts = filteredAlerts.filter((a) => isToday(a.createdAt));
  const olderAlerts = filteredAlerts.filter((a) => !isToday(a.createdAt));

  // En son kaçırılan ilaç (acil banner için)
  const urgentAlert = alerts.find((a) => a.type === 'missed' && !a.isResolved);

  const filters = [
    { key: 'all', label: 'Tümü' },
    { key: 'missed', label: 'Kaçırılan', icon: 'alert-circle' },
    { key: 'taken', label: 'Alınan', icon: 'checkmark-circle' },
    { key: 'device', label: 'Cihaz', icon: 'hardware-chip' },
    { key: 'reminder', label: 'Hatırlatma', icon: 'notifications' },
  ];

  const renderNotifCard = (notif) => {
    const iconConfig = getNotificationIcon(notif.type);
    return (
      <TouchableOpacity
        key={notif.id}
        style={[styles.notifCard, !notif.isRead && styles.notifCardNew]}
        onPress={() => handleNotifPress(notif)}
        activeOpacity={0.8}
      >
        <View style={[styles.notifIcon, { backgroundColor: iconConfig.bg }]}>
          <Ionicons name={iconConfig.name} size={22} color={iconConfig.color} />
        </View>
        <View style={styles.notifContent}>
          <View style={styles.notifHeader}>
            <Text style={styles.notifTitle}>{notif.title}</Text>
            {!notif.isRead && <View style={styles.newDot} />}
          </View>
          <Text style={styles.notifMessage}>{notif.message}</Text>
          <Text style={styles.notifTime}>{formatTimestamp(notif.createdAt)}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Bildirimler</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {alerts.length > 0 && (
              <TouchableOpacity style={styles.clearBtn} onPress={handleDeleteAll}>
                <Text style={[styles.clearBtnText, { color: colors.accent }]}>Tümünü Sil</Text>
              </TouchableOpacity>
            )}
            {unreadCount > 0 && (
              <TouchableOpacity style={styles.clearBtn} onPress={handleMarkAllRead}>
                <Text style={styles.clearBtnText}>Okundu Yap</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Active Alert Banner */}
        {urgentAlert && (
          <TouchableOpacity
            style={styles.alertBanner}
            onPress={() => {
              setSelectedNotif(urgentAlert);
              setShowAlert(true);
            }}
            activeOpacity={0.85}
          >
            <View style={styles.alertBannerIcon}>
              <Ionicons name="alert" size={24} color={colors.textOnAccent} />
            </View>
            <View style={styles.alertBannerContent}>
              <Text style={styles.alertBannerTitle}>Acil Dikkat Gerekiyor!</Text>
              <Text style={styles.alertBannerText}>
                {urgentAlert.message}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
        )}

        {/* Notification Filters */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterRow}
          contentContainerStyle={styles.filterContent}
        >
          {filters.map((filter) => (
            <TouchableOpacity
              key={filter.key}
              style={[styles.filterChip, activeFilter === filter.key && styles.filterChipActive]}
              onPress={() => setActiveFilter(filter.key)}
            >
              {filter.icon && (
                <Ionicons
                  name={filter.icon}
                  size={14}
                  color={activeFilter === filter.key ? colors.textOnPrimary : colors.textSecondary}
                />
              )}
              <Text style={[styles.filterText, activeFilter === filter.key && styles.filterTextActive]}>
                {filter.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Empty State */}
        {filteredAlerts.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="notifications-off-outline" size={48} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>Bildirim Yok</Text>
            <Text style={styles.emptySubtitle}>
              {activeFilter === 'all'
                ? 'Henüz bildirim bulunmuyor.'
                : 'Bu kategoride bildirim bulunmuyor.'}
            </Text>
          </View>
        )}

        {/* Today's section */}
        {todayAlerts.length > 0 && (
          <>
            <Text style={styles.sectionDate}>Bugün</Text>
            {todayAlerts.map(renderNotifCard)}
          </>
        )}

        {/* Older section */}
        {olderAlerts.length > 0 && (
          <>
            <Text style={styles.sectionDate}>Daha Önce</Text>
            {olderAlerts.map(renderNotifCard)}
          </>
        )}
      </ScrollView>

      {/* Alert Overlay */}
      <AlertOverlay
        visible={showAlert}
        onClose={() => setShowAlert(false)}
        patientName={patient?.name || 'Hasta'}
        medication={selectedNotif?.medication}
        compartment={selectedNotif?.compartment}
        time={selectedNotif?.time}
        onResolve={handleResolve}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: Platform.OS === 'android' ? spacing.xxxxl + 8 : spacing.xxxl,
    paddingBottom: 100,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    ...typography.headlineLarge,
    color: colors.textPrimary,
  },
  clearBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  clearBtnText: {
    ...typography.labelMedium,
    color: colors.primary,
  },
  // Alert Banner
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    ...shadows.md,
  },
  alertBannerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.lg,
  },
  alertBannerContent: {
    flex: 1,
  },
  alertBannerTitle: {
    ...typography.titleMedium,
    color: colors.textOnAccent,
    marginBottom: 2,
  },
  alertBannerText: {
    ...typography.bodySmall,
    color: 'rgba(255,255,255,0.8)',
  },
  // Filters
  filterRow: {
    marginBottom: spacing.xl,
    maxHeight: 40,
  },
  filterContent: {
    gap: spacing.sm,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterText: {
    ...typography.labelMedium,
    color: colors.textSecondary,
  },
  filterTextActive: {
    color: colors.textOnPrimary,
  },
  // Section Date
  sectionDate: {
    ...typography.titleMedium,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  // Notification Card
  notifCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  notifCardNew: {
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  notifIcon: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.lg,
  },
  notifContent: {
    flex: 1,
  },
  notifHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  notifTitle: {
    ...typography.titleMedium,
    color: colors.textPrimary,
    flex: 1,
  },
  newDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  notifMessage: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: spacing.xs,
  },
  notifTime: {
    ...typography.labelSmall,
    color: colors.textTertiary,
  },
  // Empty State
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxxl,
    gap: spacing.md,
  },
  emptyTitle: {
    ...typography.titleLarge,
    color: colors.textSecondary,
  },
  emptySubtitle: {
    ...typography.bodySmall,
    color: colors.textTertiary,
    textAlign: 'center',
  },
});

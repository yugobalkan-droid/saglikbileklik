import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
  TouchableOpacity,
  Pressable,
  Platform,
  Alert,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';
import DeviceStatusBadge from '../components/DeviceStatusBadge';
import TimelineItem from '../components/TimelineItem';
import MedicationCard from '../components/MedicationCard';
import FAB from '../components/FAB';
import BottomSheet from '../components/BottomSheet';
import { usePatient } from '../context/PatientContext';
import { useAuth } from '../context/AuthContext';
import { useBLE } from '../context/BLEContext';
import { seedDemoData } from '../utils/seedData';
import { createPatient } from '../services/patientService';

const PERIOD_NAMES = ['Sabah', 'Öğle', 'Akşam'];
const PERIOD_TIMES = ['08:00', '14:00', '20:00'];

export default function DashboardScreen({ navigation }) {
  const { user } = useAuth();
  const {
    patient,
    patientId,
    setPatientId,
    deviceStatus,
    todayLogs,
    todayStats,
    nextMedication,
    scheduleGrid,
    loading,
    alerts,
  } = usePatient();
  const {
    bleConnected,
    bleScanning,
    bleStatus,
    batteryLevel,
    chargeState,
    chargeStateText,
    alarmActive,
    batteryIcon,
    batteryColor,
    connectWristband,
    disconnectWristband,
    triggerAlarm,
    stopAlarm,
  } = useBLE();
  const { triggerDeviceAlarm, stopDeviceAlarm } = require('../services/deviceService');

  const [showAddSheet, setShowAddSheet] = useState(false);
  const [seeding, setSeeding] = useState(false);

  // Alarm işlemleri (Web ve BLE uyumlu)
  const handleTriggerAlarm = async () => {
    if (Platform.OS === 'web' || !bleConnected) {
      await triggerDeviceAlarm(patientId);
    } else {
      triggerAlarm();
    }
  };

  const handleStopAlarm = async () => {
    if (Platform.OS === 'web' || !bleConnected) {
      await stopDeviceAlarm(patientId);
    } else {
      stopAlarm();
    }
  };

  // Hasta ekleme state'leri
  const [showPatientSheet, setShowPatientSheet] = useState(false);
  const [newPatientName, setNewPatientName] = useState('');
  const [newPatientAge, setNewPatientAge] = useState('');
  const [newPatientDiagnosis, setNewPatientDiagnosis] = useState('');
  const [savingPatient, setSavingPatient] = useState(false);

  const today = new Date();
  const dayNames = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const todayStr = `${today.getDate()} ${monthNames[today.getMonth()]} ${today.getFullYear()}, ${dayNames[today.getDay()]}`;

  // Timeline verilerini loglardan ve scheduleGrid'den oluştur
  // Bugüne ait bildirimler (alınan/kaçırılan)
  const todayAlerts = alerts ? alerts.filter(a => {
    if (!a.createdAt) return false;
    const date = a.createdAt?.toDate?.() || new Date(a.createdAt);
    return date.toDateString() === new Date().toDateString();
  }) : [];

  // Timeline verilerini loglardan ve scheduleGrid'den oluştur
  const getTimelineData = () => {
    const todayIndex = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
    const currentHour = new Date().getHours();
    const currentMin = new Date().getMinutes();
    const currentTimeMinutes = currentHour * 60 + currentMin;

    return PERIOD_NAMES.map((name, idx) => {
      const cellDataArray = scheduleGrid[idx]?.[todayIndex] || [];
      const hasMed = cellDataArray.length > 0;
      let timeStr = hasMed ? cellDataArray[0].time : PERIOD_TIMES[idx];
      let status = 'upcoming';

      // Saati hesapla (Örn: "08:00" -> 480 dakika)
      const [h, m] = timeStr.split(':').map(Number);
      const scheduledMinutes = h * 60 + m;

      // Bildirimlerden durum tespiti (Sabah=0, Öğle=1, Akşam=2)
      // Yaklaşık saat uyuşması veya periyot mantığı ile alınan/kaçırılan bulunabilir.
      // Basitleştirmek için zamanın geçip geçmediğine ve taken/missed bildirimlerine bakalım.
      if (hasMed) {
        // Bu periyot için 'taken' bildirimi var mı?
        // (Çok kaba bir eşleşme: Eğer bugün 'taken' varsa ve saat uyuyorsa)
        // Saat kontrolünü esnetelim, eğer vakti geçmişse:
        if (currentTimeMinutes >= scheduledMinutes) {
          // İlaç saati gelmiş veya geçmiş
          const isTaken = todayAlerts.some(a => a.type === 'taken');
          // Gerçek hayatta her periyodu ayrı tutmak gerekir, şimdilik basit simülasyon:
          if (isTaken && idx === 0) {
             status = 'completed';
          } else if (currentTimeMinutes > scheduledMinutes + 30) {
             // 30 dk geçtiyse kaçırıldı
             status = 'missed';
          } else {
             status = 'upcoming'; // Henüz 30 dk dolmadı veya yeni çalıyor
          }
        }
      }
      
      return {
        id: String(idx),
        time: timeStr,
        title: name,
        status: hasMed ? status : 'upcoming',
        isNext: hasMed && status === 'upcoming',
        medications: hasMed ? cellDataArray.map(med => ({ name: med.name || med.medicationName, dose: med.dosage || '1 doz' })) : [],
      };
    });
  };

  const timelineData = getTimelineData();

  // Dinamik istatistikleri (todayStats) hesapla
  const dynamicStats = { taken: 0, missed: 0, pending: 0, total: 0 };
  timelineData.forEach(item => {
    if (item.medications.length > 0) {
      dynamicStats.total++;
      if (item.status === 'completed') dynamicStats.taken++;
      else if (item.status === 'missed') dynamicStats.missed++;
      else dynamicStats.pending++;
    }
  });

  const handleSeedData = async () => {
    if (!user) return;
    setSeeding(true);
    try {
      const pId = await seedDemoData(user.uid);
      setPatientId(pId);
      Alert.alert('Başarılı', 'Demo veriler yüklendi! Uygulama güncellenecek.');
    } catch (error) {
      Alert.alert('Hata', 'Demo veriler yüklenirken hata oluştu: ' + error.message);
    }
    setSeeding(false);
  };

  const handleAddPatient = async () => {
    if (!newPatientName.trim()) {
      Alert.alert('Hata', 'Hasta adı gereklidir.');
      return;
    }
    setSavingPatient(true);
    try {
      const pId = await createPatient({
        name: newPatientName.trim(),
        age: newPatientAge.trim() || null,
        diagnosis: newPatientDiagnosis.trim() || null,
        caregiverId: user.uid,
      });
      setPatientId(pId);
      setShowPatientSheet(false);
      setNewPatientName('');
      setNewPatientAge('');
      setNewPatientDiagnosis('');
      Alert.alert('Başarılı', 'Hasta başarıyla eklendi!');
    } catch (error) {
      Alert.alert('Hata', 'Hasta eklenirken hata oluştu: ' + error.message);
    }
    setSavingPatient(false);
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Hoş geldiniz 👋</Text>
            <Text style={styles.dateText}>{todayStr}</Text>
          </View>
          <TouchableOpacity style={styles.profileBtn}>
            <Ionicons name="person-circle-outline" size={40} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Patient Info Card */}
        {patient ? (
          <View style={styles.patientCard}>
            <View style={styles.patientCardGradient}>
              <View style={styles.patientHeader}>
                <View style={styles.patientAvatar}>
                  <Text style={styles.patientInitials}>
                    {patient.name ? patient.name.split(' ').map((n) => n[0]).join('') : '?'}
                  </Text>
                </View>
                <View style={styles.patientInfo}>
                  <Text style={styles.patientName}>{patient.name || 'Hasta'}</Text>
                  <Text style={styles.patientAge}>
                    {patient.age ? `${patient.age} yaş` : ''} {patient.diagnosis ? `• ${patient.diagnosis}` : ''}
                  </Text>
                </View>
              </View>
              <View style={styles.deviceStatusRow}>
                <DeviceStatusBadge
                  label="Kutu"
                  status={deviceStatus.box?.status || 'offline'}
                  icon="cube-outline"
                />
                <DeviceStatusBadge
                  label="Bileklik"
                  status={(bleConnected || deviceStatus?.bracelet?.status === 'online') ? 'online' : 'offline'}
                  icon="watch-outline"
                  batteryLevel={bleConnected ? batteryLevel : deviceStatus?.bracelet?.batteryLevel}
                />
              </View>
            </View>
          </View>
        ) : (
          /* Hasta yoksa — hasta ekle kartı */
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="person-add" size={32} color={colors.primary} />
            </View>
            <Text style={styles.emptyTitle}>Hasta Tanımlanmamış</Text>
            <Text style={styles.emptySubtitle}>
              Sistemi kullanmaya başlamak için bir hasta ekleyin veya demo verilerle test edin.
            </Text>
            <TouchableOpacity
              style={styles.emptyPrimaryBtn}
              onPress={() => setShowPatientSheet(true)}
            >
              <Ionicons name="person-add-outline" size={20} color={colors.textOnPrimary} />
              <Text style={styles.emptyPrimaryBtnText}>Hasta Ekle</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.emptySecondaryBtn}
              onPress={handleSeedData}
              disabled={seeding}
            >
              <Ionicons name="cloud-download-outline" size={18} color={colors.primary} />
              <Text style={styles.emptySecondaryBtnText}>
                {seeding ? 'Yükleniyor...' : 'Demo Veri ile Test Et'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: colors.successSurface }]}>
            <Ionicons name="checkmark-circle" size={24} color={colors.success} />
            <Text style={styles.statValue}>
              {dynamicStats.taken}/{dynamicStats.total || 0}
            </Text>
            <Text style={styles.statLabel}>Alınan</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.warningSurface }]}>
            <Ionicons name="time" size={24} color={colors.warning} />
            <Text style={styles.statValue}>{dynamicStats.pending}</Text>
            <Text style={styles.statLabel}>Kalan</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.accentSurface }]}>
            <Ionicons name="alert-circle" size={24} color={colors.accent} />
            <Text style={styles.statValue}>{dynamicStats.missed}</Text>
            <Text style={styles.statLabel}>Kaçırılan</Text>
          </View>
        </View>

        {/* ── Bileklik BLE/WiFi Widget ── */}
        <View style={styles.wristbandCard}>
          <View style={styles.wristbandHeader}>
            <View style={styles.wristbandTitleRow}>
              <Ionicons name="watch-outline" size={20} color={colors.primary} />
              <Text style={styles.wristbandTitle}>Bileklik</Text>
            </View>
            <View style={[styles.wristbandStatusDot, 
              { backgroundColor: (bleConnected || deviceStatus?.box?.status === 'online') ? colors.online : colors.offline }]} />
          </View>

          {(bleConnected || deviceStatus?.box?.status === 'online') ? (
            <View>
              {/* Pil & Şarj Bilgisi */}
              <View style={styles.wristbandInfoRow}>
                <View style={styles.wristbandInfoItem}>
                  <Ionicons 
                    name={bleConnected ? batteryIcon : 'battery-full'} 
                    size={22} 
                    color={bleConnected ? batteryColor : colors.success} 
                  />
                  <Text style={[styles.wristbandInfoValue, { color: (bleConnected || deviceStatus?.bracelet?.status === 'online') ? batteryColor : colors.success }]}>
                    {(bleConnected && batteryLevel !== null) ? `${batteryLevel}%` : (deviceStatus?.bracelet?.batteryLevel !== undefined ? `${deviceStatus?.bracelet?.batteryLevel}%` : '--')}
                  </Text>
                  <Text style={styles.wristbandInfoLabel}>Durum</Text>
                </View>
                <View style={styles.wristbandInfoDivider} />
                <View style={styles.wristbandInfoItem}>
                  <Ionicons 
                    name={(bleConnected ? chargeState : 0) === 1 ? 'flash' : 
                          (bleConnected ? chargeState : 0) === 2 ? 'checkmark-circle' : 'flash-off-outline'} 
                    size={22} 
                    color={(bleConnected ? chargeState : 0) === 1 ? '#FBBC04' : 
                           (bleConnected ? chargeState : 0) === 2 ? colors.success : colors.textTertiary} 
                  />
                  <Text style={styles.wristbandInfoValue}>
                    {(bleConnected ? chargeState : 0) === 1 ? 'Şarj Oluyor' : 
                     (bleConnected ? chargeState : 0) === 2 ? 'Dolu' : 'Bilinmiyor'}
                  </Text>
                  <Text style={styles.wristbandInfoLabel}>Şarj</Text>
                </View>
                <View style={styles.wristbandInfoDivider} />
                <View style={styles.wristbandInfoItem}>
                  <Ionicons 
                    name={(bleConnected ? alarmActive : deviceStatus?.bracelet?.alarmActive) ? 'notifications' : 'notifications-off-outline'} 
                    size={22} 
                    color={(bleConnected ? alarmActive : deviceStatus?.bracelet?.alarmActive) ? colors.accent : colors.textTertiary} 
                  />
                  <Text style={styles.wristbandInfoValue}>
                    {(bleConnected ? alarmActive : deviceStatus?.bracelet?.alarmActive) ? 'Aktif' : 'Kapalı'}
                  </Text>
                  <Text style={styles.wristbandInfoLabel}>Alarm</Text>
                </View>
              </View>

              {/* Alarm Kontrol Butonları */}
              <View style={styles.wristbandActions}>
                {(bleConnected ? alarmActive : deviceStatus?.bracelet?.alarmActive) ? (
                  <TouchableOpacity style={styles.wristbandStopBtn} onPress={handleStopAlarm}>
                    <Ionicons name="stop-circle-outline" size={18} color="#FFF" />
                    <Text style={styles.wristbandBtnText}>Alarmı Durdur</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.wristbandAlarmBtn} onPress={handleTriggerAlarm}>
                    <Ionicons name="notifications-outline" size={18} color="#FFF" />
                    <Text style={styles.wristbandBtnText}>Alarm Gönder</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.wristbandDisconnectBtn} onPress={disconnectWristband}>
                  <Ionicons name={Platform.OS === 'web' ? 'wifi-outline' : 'bluetooth-outline'} size={18} color={colors.accent} />
                  <Text style={[styles.wristbandBtnText, { color: colors.accent }]}>
                    {Platform.OS === 'web' ? 'Yenile' : 'Bağlantıyı Kes'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.wristbandDisconnected}>
              <Text style={styles.wristbandDisconnectedText}>
                {Platform.OS === 'web' ? 'Bileklik ağa bağlı değil (Kutu çevrimdışı)' :
                 (bleStatus === 'scanning' ? 'Bileklik aranıyor...' :
                 bleStatus === 'connecting' ? 'Bağlanıyor...' :
                 bleStatus === 'not_found' ? 'Bileklik bulunamadı' :
                 bleStatus === 'failed' ? 'Bağlantı başarısız' :
                 'Bileklik bağlı değil')}
              </Text>
              
              {Platform.OS !== 'web' && (
                <TouchableOpacity 
                  style={styles.wristbandConnectBtn} 
                  onPress={connectWristband}
                  disabled={bleScanning}
                >
                  {bleScanning ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <>
                      <Ionicons name="bluetooth-outline" size={18} color="#FFF" />
                      <Text style={styles.wristbandBtnText}>Bilekliği Bağla</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* Next Medication Highlight */}
        {nextMedication && (
          <MedicationCard
            compartment={nextMedication.compartment || '?'}
            medication={nextMedication.medicationName}
            time={(() => {
              const t = nextMedication.scheduledTime?.toDate?.();
              return t ? `${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')} - ${PERIOD_NAMES[nextMedication.period] || ''}` : '';
            })()}
            isNext={true}
          />
        )}

        {/* Timeline Section */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Bugünün Programı</Text>
          <TouchableOpacity>
            <Text style={styles.seeAllBtn}>Tümünü Gör</Text>
          </TouchableOpacity>
        </View>

        {timelineData.map((item) => (
          <TimelineItem
            key={item.id}
            time={item.time}
            title={item.title}
            medications={item.medications}
            status={item.status}
            isNext={item.isNext}
          />
        ))}
      </ScrollView>

      {/* FAB */}
      <FAB onPress={() => setShowAddSheet(true)} />

      {/* Add Medication Bottom Sheet */}
      <BottomSheet
        visible={showAddSheet}
        onClose={() => setShowAddSheet(false)}
        title="Yeni Hatırlatıcı"
      >
        <View style={styles.sheetContent}>
          <TouchableOpacity style={styles.sheetOption} activeOpacity={0.7} onPress={() => {
            setShowAddSheet(false);
            setTimeout(() => navigation.navigate('Schedule'), 300);
          }}>
            <View style={[styles.sheetOptionIcon, { backgroundColor: colors.primarySurface }]}>
              <Ionicons name="medical" size={22} color={colors.primary} />
            </View>
            <View style={styles.sheetOptionText}>
              <Text style={styles.sheetOptionTitle}>İlaç Ekle</Text>
              <Text style={styles.sheetOptionDesc}>Yeni bir ilaç hatırlatıcısı oluştur</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.sheetOption} activeOpacity={0.7} onPress={() => {
            setShowAddSheet(false);
            setTimeout(() => navigation.navigate('Schedule'), 300);
          }}>
            <View style={[styles.sheetOptionIcon, { backgroundColor: colors.secondarySurface }]}>
              <Ionicons name="calendar" size={22} color={colors.secondary} />
            </View>
            <View style={styles.sheetOptionText}>
              <Text style={styles.sheetOptionTitle}>Program Düzenle</Text>
              <Text style={styles.sheetOptionDesc}>Haftalık ilaç programını düzenle</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
          </TouchableOpacity>

          {!patient && (
            <>
              <TouchableOpacity style={styles.sheetOption} activeOpacity={0.7} onPress={() => {
                setShowAddSheet(false);
                setTimeout(() => setShowPatientSheet(true), 300);
              }}>
                <View style={[styles.sheetOptionIcon, { backgroundColor: colors.successSurface }]}>
                  <Ionicons name="person-add" size={22} color={colors.success} />
                </View>
                <View style={styles.sheetOptionText}>
                  <Text style={styles.sheetOptionTitle}>Hasta Ekle</Text>
                  <Text style={styles.sheetOptionDesc}>Yeni hasta tanımlayın</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
              </TouchableOpacity>

              <TouchableOpacity style={styles.sheetOption} activeOpacity={0.7} onPress={() => {
                setShowAddSheet(false);
                setTimeout(() => handleSeedData(), 300);
              }}>
                <View style={[styles.sheetOptionIcon, { backgroundColor: colors.accentSurface }]}>
                  <Ionicons name="cloud-download" size={22} color={colors.accent} />
                </View>
                <View style={styles.sheetOptionText}>
                  <Text style={styles.sheetOptionTitle}>Demo Veri Yükle</Text>
                  <Text style={styles.sheetOptionDesc}>Test için örnek veriler oluştur</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </BottomSheet>

      {/* Hasta Ekleme Bottom Sheet */}
      <BottomSheet
        visible={showPatientSheet}
        onClose={() => setShowPatientSheet(false)}
        title="Yeni Hasta Ekle"
      >
        <View style={styles.patientSheetBody}>
          <Text style={styles.patientSheetDesc}>
            Takip etmek istediğiniz hastanın bilgilerini girin.
          </Text>

          <Text style={styles.inputLabel}>Hasta Adı Soyadı *</Text>
          <TextInput
            style={styles.textInput}
            value={newPatientName}
            onChangeText={setNewPatientName}
            placeholder="Örn: Ayşe Yılmaz"
            placeholderTextColor={colors.textTertiary}
            editable={!savingPatient}
          />

          <View style={styles.formRow}>
            <View style={{ flex: 1, marginRight: spacing.md }}>
              <Text style={styles.inputLabel}>Yaşı</Text>
              <TextInput
                style={styles.textInput}
                value={newPatientAge}
                onChangeText={setNewPatientAge}
                placeholder="Örn: 74"
                keyboardType="numeric"
                placeholderTextColor={colors.textTertiary}
                editable={!savingPatient}
              />
            </View>
            <View style={{ flex: 2 }}>
              <Text style={styles.inputLabel}>Teşhis / Hastalık</Text>
              <TextInput
                style={styles.textInput}
                value={newPatientDiagnosis}
                onChangeText={setNewPatientDiagnosis}
                placeholder="Örn: Alzheimer"
                placeholderTextColor={colors.textTertiary}
                editable={!savingPatient}
              />
            </View>
          </View>

          <Pressable
            style={[styles.savePatientBtn, savingPatient && { opacity: 0.7 }]}
            onPress={handleAddPatient}
            disabled={savingPatient}
          >
            {savingPatient ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color={colors.textOnPrimary} />
                <Text style={styles.savePatientBtnText}>Kaydet ve Başla</Text>
              </>
            )}
          </Pressable>
        </View>
      </BottomSheet>
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
    marginBottom: spacing.xxl,
  },
  greeting: {
    ...typography.headlineLarge,
    color: colors.textPrimary,
  },
  dateText: {
    ...typography.bodyMedium,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  profileBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Patient Card
  patientCard: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    marginBottom: spacing.xl,
    ...shadows.md,
  },
  patientCardGradient: {
    backgroundColor: colors.surface,
    padding: spacing.xl,
    borderRadius: borderRadius.lg,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  patientHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  patientAvatar: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.lg,
  },
  patientInitials: {
    ...typography.titleLarge,
    color: colors.textOnPrimary,
  },
  patientInfo: {
    flex: 1,
  },
  patientName: {
    ...typography.headlineSmall,
    color: colors.textPrimary,
  },
  patientAge: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: 2,
  },
  deviceStatusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  // Empty Card
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.xxl,
    alignItems: 'center',
    marginBottom: spacing.xl,
    ...shadows.md,
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primarySurface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  emptyTitle: {
    ...typography.headlineSmall,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  emptySubtitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.xl,
  },
  emptyPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
    width: '100%',
    ...shadows.md,
    marginBottom: spacing.md,
  },
  emptyPrimaryBtnText: {
    ...typography.titleMedium,
    color: colors.textOnPrimary,
  },
  emptySecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  emptySecondaryBtnText: {
    ...typography.bodyMedium,
    color: colors.primary,
  },
  // Stats
  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  statCard: {
    flex: 1,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
  statValue: {
    ...typography.headlineMedium,
    color: colors.textPrimary,
  },
  statLabel: {
    ...typography.labelSmall,
    color: colors.textSecondary,
  },
  // Section
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
    marginTop: spacing.sm,
  },
  sectionTitle: {
    ...typography.headlineSmall,
    color: colors.textPrimary,
  },
  seeAllBtn: {
    ...typography.labelLarge,
    color: colors.primary,
  },
  // Bottom Sheet Content
  sheetContent: {
    gap: spacing.md,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.md,
  },
  sheetOptionIcon: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.lg,
  },
  sheetOptionText: {
    flex: 1,
  },
  sheetOptionTitle: {
    ...typography.titleMedium,
    color: colors.textPrimary,
  },
  sheetOptionDesc: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: 2,
  },
  // Hasta ekleme bottom sheet
  patientSheetBody: {
    paddingBottom: spacing.xl,
  },
  patientSheetDesc: {
    ...typography.bodyMedium,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },
  inputLabel: {
    ...typography.labelLarge,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  textInput: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...typography.bodyLarge,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  savePatientBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
    ...shadows.md,
    marginTop: spacing.sm,
  },
  savePatientBtnText: {
    ...typography.titleMedium,
    color: colors.textOnPrimary,
  },
  // ── Bileklik BLE Widget ──
  wristbandCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    marginBottom: spacing.xl,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    ...shadows.md,
  },
  wristbandHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  wristbandTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  wristbandTitle: {
    ...typography.headlineSmall,
    color: colors.textPrimary,
  },
  wristbandStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  wristbandInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.lg,
    marginBottom: spacing.lg,
  },
  wristbandInfoItem: {
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
  },
  wristbandInfoValue: {
    ...typography.titleMedium,
    color: colors.textPrimary,
  },
  wristbandInfoLabel: {
    ...typography.labelSmall,
    color: colors.textTertiary,
  },
  wristbandInfoDivider: {
    width: 1,
    height: 36,
    backgroundColor: colors.border,
  },
  wristbandActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  wristbandAlarmBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    gap: spacing.xs,
  },
  wristbandStopBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    gap: spacing.xs,
  },
  wristbandDisconnectBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceVariant,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  wristbandBtnText: {
    ...typography.labelLarge,
    color: '#FFF',
  },
  wristbandDisconnected: {
    alignItems: 'center',
    gap: spacing.lg,
  },
  wristbandDisconnectedText: {
    ...typography.bodyMedium,
    color: colors.textSecondary,
  },
  wristbandConnectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
    ...shadows.sm,
  },
});

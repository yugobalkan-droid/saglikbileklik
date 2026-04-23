import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Platform,
  Switch,
  Alert,
  ActivityIndicator,
  TextInput,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';
import { useAuth } from '../context/AuthContext';
import { usePatient } from '../context/PatientContext';
import { signOut } from '../services/authService';
import { createPatient, updatePatient, addEmergencyContact } from '../services/patientService';
import { updateProfile } from 'firebase/auth';
import { auth } from '../config/firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import BottomSheet from '../components/BottomSheet';

const SettingsItem = ({ icon, iconBg, iconColor, title, subtitle, hasSwitch, switchValue, onSwitchChange, onPress, hasChevron = true, danger }) => (
  <TouchableOpacity
    style={styles.settingsItem}
    onPress={onPress}
    activeOpacity={hasSwitch ? 1 : 0.7}
    disabled={hasSwitch && !onPress}
  >
    <View style={[styles.settingsIcon, { backgroundColor: iconBg || colors.primarySurface }]}>
      <Ionicons name={icon} size={20} color={iconColor || colors.primary} />
    </View>
    <View style={styles.settingsContent}>
      <Text style={[styles.settingsTitle, danger && { color: colors.accent }]}>{title}</Text>
      {subtitle && <Text style={styles.settingsSubtitle}>{subtitle}</Text>}
    </View>
    {hasSwitch ? (
      <Switch
        value={switchValue}
        onValueChange={onSwitchChange}
        trackColor={{ false: colors.border, true: colors.primaryLight }}
        thumbColor={switchValue ? colors.primary : colors.surfaceVariant}
      />
    ) : hasChevron ? (
      <Ionicons name="chevron-forward" size={20} color={danger ? colors.accent : colors.textTertiary} />
    ) : null}
  </TouchableOpacity>
);

export default function SettingsScreen() {
  const { user, userProfile } = useAuth();
  const { patient, deviceStatus, setPatientId } = usePatient();
  const [loggingOut, setLoggingOut] = useState(false);
  
  // Hasta ekleme modal state'leri
  const [patientSheetVisible, setPatientSheetVisible] = useState(false);
  const [newPatientName, setNewPatientName] = useState('');
  const [newPatientAge, setNewPatientAge] = useState('');
  const [newPatientDiagnosis, setNewPatientDiagnosis] = useState('');
  const [savingPatient, setSavingPatient] = useState(false);

  // Bildirim tercihleri (lokal state)
  const [pushNotifs, setPushNotifs] = useState(true);
  const [soundAlerts, setSoundAlerts] = useState(true);
  const [vibration, setVibration] = useState(true);

  // Profil düzenleme
  const [profileSheetVisible, setProfileSheetVisible] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Hasta profili düzenleme
  const [editPatientSheetVisible, setEditPatientSheetVisible] = useState(false);
  const [editPatientName, setEditPatientName] = useState('');
  const [editPatientAge, setEditPatientAge] = useState('');
  const [editPatientDiagnosis, setEditPatientDiagnosis] = useState('');
  const [savingEditPatient, setSavingEditPatient] = useState(false);

  // Acil durum kişisi ekleme
  const [emergencySheetVisible, setEmergencySheetVisible] = useState(false);
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [emergencyRelation, setEmergencyRelation] = useState('');
  const [savingEmergency, setSavingEmergency] = useState(false);

  // Cihaz detay
  const [deviceSheetVisible, setDeviceSheetVisible] = useState(false);
  const [deviceSheetType, setDeviceSheetType] = useState('box');

  // Gecikme süresi
  const [delaySheetVisible, setDelaySheetVisible] = useState(false);
  const [selectedDelay, setSelectedDelay] = useState(30);

  // Tema
  const [themeSheetVisible, setThemeSheetVisible] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState('light');

  // Dil
  const [langSheetVisible, setLangSheetVisible] = useState(false);
  const [selectedLang, setSelectedLang] = useState('tr');

  const handleSignOut = () => {
    Alert.alert(
      'Çıkış Yap',
      'Hesabınızdan çıkış yapmak istediğinize emin misiniz?',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Çıkış Yap',
          style: 'destructive',
          onPress: async () => {
            setLoggingOut(true);
            try {
              await signOut();
            } catch (error) {
              Alert.alert('Hata', 'Çıkış yapılırken hata oluştu.');
              setLoggingOut(false);
            }
          },
        },
      ]
    );
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
      setPatientSheetVisible(false);
      setNewPatientName('');
      setNewPatientAge('');
      setNewPatientDiagnosis('');
      Alert.alert('Başarılı', 'Hasta başarıyla eklendi!');
    } catch (error) {
      Alert.alert('Hata', 'Hasta eklenirken hata oluştu: ' + error.message);
    }
    setSavingPatient(false);
  };

  // Profil düzenleme kaydet
  const handleSaveProfile = async () => {
    if (!editDisplayName.trim()) {
      Alert.alert('Hata', 'İsim gereklidir.');
      return;
    }
    setSavingProfile(true);
    try {
      await updateProfile(auth.currentUser, { displayName: editDisplayName.trim() });
      // Firestore'daki kullanıcı belgesini de güncelle
      const userDocRef = doc(db, 'users', user.uid);
      await updateDoc(userDocRef, {
        displayName: editDisplayName.trim(),
        updatedAt: serverTimestamp(),
      });
      setProfileSheetVisible(false);
      Alert.alert('Başarılı', 'Profil güncellendi!');
    } catch (error) {
      Alert.alert('Hata', 'Profil güncellenirken hata oluştu: ' + error.message);
    }
    setSavingProfile(false);
  };

  // Hasta profili düzenleme kaydet
  const handleSaveEditPatient = async () => {
    if (!editPatientName.trim()) {
      Alert.alert('Hata', 'Hasta adı gereklidir.');
      return;
    }
    setSavingEditPatient(true);
    try {
      await updatePatient(patient.id, {
        name: editPatientName.trim(),
        age: editPatientAge.trim() || null,
        diagnosis: editPatientDiagnosis.trim() || null,
      });
      setEditPatientSheetVisible(false);
      Alert.alert('Başarılı', 'Hasta bilgileri güncellendi!');
    } catch (error) {
      Alert.alert('Hata', 'Güncelleme sırasında hata oluştu: ' + error.message);
    }
    setSavingEditPatient(false);
  };

  // Acil durum kişisi kaydet
  const handleSaveEmergency = async () => {
    if (!emergencyName.trim() || !emergencyPhone.trim()) {
      Alert.alert('Hata', 'Ad ve telefon numarası gereklidir.');
      return;
    }
    setSavingEmergency(true);
    try {
      await addEmergencyContact(patient.id, {
        name: emergencyName.trim(),
        phone: emergencyPhone.trim(),
        relation: emergencyRelation.trim() || null,
      });
      setEmergencySheetVisible(false);
      setEmergencyName('');
      setEmergencyPhone('');
      setEmergencyRelation('');
      Alert.alert('Başarılı', 'Acil durum kişisi eklendi!');
    } catch (error) {
      Alert.alert('Hata', 'Kayıt sırasında hata oluştu: ' + error.message);
    }
    setSavingEmergency(false);
  };

  // Profil düzenleme aç
  const openProfileEdit = () => {
    setEditDisplayName(user?.displayName || userProfile?.displayName || '');
    setProfileSheetVisible(true);
  };

  // Hasta profili düzenleme aç
  const openPatientEdit = () => {
    if (!patient) return;
    setEditPatientName(patient.name || '');
    setEditPatientAge(patient.age?.toString() || '');
    setEditPatientDiagnosis(patient.diagnosis || '');
    setEditPatientSheetVisible(true);
  };

  // Tıbbi notlar düzenleme
  const openMedicalNotes = () => {
    if (!patient) return;
    setEditPatientName(patient.name || '');
    setEditPatientAge(patient.age?.toString() || '');
    setEditPatientDiagnosis(patient.diagnosis || '');
    setEditPatientSheetVisible(true);
  };

  // Acil durum kişileri aç
  const openEmergencyContacts = () => {
    if (!patient) return;
    setEmergencyName('');
    setEmergencyPhone('');
    setEmergencyRelation('');
    setEmergencySheetVisible(true);
  };

  // Cihaz detay aç
  const openDeviceDetail = (type) => {
    setDeviceSheetType(type);
    setDeviceSheetVisible(true);
  };

  // Hakkında
  const handleAbout = () => {
    Alert.alert(
      'CareSync v1.0.0',
      'Akıllı İlaç Takip Sistemi\n\n' +
      '• ESP32 tabanlı akıllı ilaç kutusu\n' +
      '• NRF24L01 2.4GHz kablosuz haberleşme\n' +
      '• LED (GPIO 4) | Buzzer (GPIO 46) | Buton (GPIO 36)\n' +
      '• Firebase bulut altyapısı\n\n' +
      '© 2026 CareSync\nTüm hakları saklıdır.',
      [{ text: 'Tamam' }]
    );
  };

  // Kullanıcı bilgileri
  const displayName = user?.displayName || userProfile?.displayName || 'Bakıcı';
  const email = user?.email || 'E-posta yok';
  const initials = displayName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  // Cihaz durumu metinleri
  const boxStatusText = deviceStatus?.box?.status === 'online'
    ? `Bağlı • Sinyal: ${deviceStatus.box.signalStrength === 'strong' ? 'Güçlü' : deviceStatus.box.signalStrength === 'medium' ? 'Orta' : 'Zayıf'}`
    : 'Çevrimdışı';

  const braceletStatusText = deviceStatus?.bracelet?.status === 'online'
    ? `Pil: %${deviceStatus.bracelet.batteryLevel || 0} • Bağlı`
    : 'Çevrimdışı';

  const boxIconBg = deviceStatus?.box?.status === 'online' ? colors.successSurface : colors.accentSurface;
  const braceletIconBg = deviceStatus?.bracelet?.status === 'online' ? colors.successSurface : colors.accentSurface;

  const delayOptions = [
    { value: 15, label: '15 dakika' },
    { value: 30, label: '30 dakika' },
    { value: 45, label: '45 dakika' },
    { value: 60, label: '1 saat' },
  ];

  // ESP32 Test Sinyali
  const handleTestESP32 = async () => {
    try {
      const boxRef = doc(db, 'devices', 'esp32_medicine_box_01');
      await updateDoc(boxRef, {
        triggerAlert: true,
        updatedAt: serverTimestamp()
      });
      Alert.alert('Test Gönderildi', 'ESP32 cihazına test sinyali gönderildi! Kutu üzerindeki LED yanmalı ve Buzzer sesli uyarı vermelidir.');
    } catch (error) {
      Alert.alert('Hata', 'Test sinyali gönderilemedi. Cihazın Firebase ile eşleştiğinden emin olun. Hata: ' + error.message);
    }
  };

  // ESP32 Test Sinyali Durdur
  const handleStopTestESP32 = async () => {
    try {
      const boxRef = doc(db, 'devices', 'esp32_medicine_box_01');
      await updateDoc(boxRef, {
        triggerAlert: false,
        updatedAt: serverTimestamp()
      });
      Alert.alert('Test Durduruldu', 'ESP32 cihazına testi durdurma sinyali gönderildi! LED ve alarm kapanacaktır.');
    } catch (error) {
      Alert.alert('Hata', 'Test durdurma sinyali gönderilemedi. Hata: ' + error.message);
    }
  };

  if (loggingOut) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Çıkış yapılıyor...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Text style={styles.title}>Ayarlar</Text>

        {/* Profile Card */}
        <View style={styles.profileCard}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileInitials}>{initials}</Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{displayName}</Text>
            <Text style={styles.profileEmail}>{email}</Text>
          </View>
          <TouchableOpacity style={styles.editBtn} onPress={openProfileEdit}>
            <Ionicons name="create-outline" size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Patient Section */}
        <Text style={styles.sectionTitle}>Hasta Bilgileri</Text>
        <View style={styles.settingsGroup}>
          {patient ? (
            <>
              <SettingsItem
                icon="person-outline"
                title="Hasta Profili"
                subtitle={`${patient.name || 'İsimsiz'}${patient.age ? `, ${patient.age} yaş` : ''}`}
                onPress={openPatientEdit}
              />
              <View style={styles.divider} />
              <SettingsItem
                icon="document-text-outline"
                title="Tıbbi Notlar"
                subtitle={patient.diagnosis || 'Tanı bilgisi yok'}
                onPress={openMedicalNotes}
              />
              <View style={styles.divider} />
              <SettingsItem
                icon="people-outline"
                title="Acil Durum Kişileri"
                subtitle="Kişi ekle veya görüntüle"
                onPress={openEmergencyContacts}
              />
            </>
          ) : (
            <SettingsItem
              icon="add-circle-outline"
              title="Hasta Ekle"
              subtitle="Henüz listeye hasta tanımlanmamış. Buraya dokunarak hastanızı ekleyiniz."
              onPress={() => setPatientSheetVisible(true)}
            />
          )}
        </View>

        {/* Device Section */}
        <Text style={styles.sectionTitle}>Cihaz Yönetimi</Text>
        <View style={styles.settingsGroup}>
          <SettingsItem
            icon="cube-outline"
            title="ESP32 İlaç Kutusu"
            subtitle={boxStatusText}
            iconBg={boxIconBg}
            onPress={() => openDeviceDetail('box')}
          />
          <View style={styles.divider} />
          <SettingsItem
            icon="watch-outline"
            title="Bileklik (ESP32)"
            subtitle={braceletStatusText}
            iconBg={braceletIconBg}
            onPress={() => openDeviceDetail('bracelet')}
          />
          <View style={styles.divider} />
          <SettingsItem
            icon="radio-outline"
            title="NRF24L01 Bağlantısı"
            subtitle="2.4GHz • Aktif"
            iconBg={colors.infoSurface}
            onPress={() => openDeviceDetail('rf')}
          />
          <View style={styles.divider} />
          <SettingsItem
            icon="beaker-outline"
            title="ESP32 Test Modülü"
            subtitle="LED ve Buzzer alarmını manuel test et"
            iconBg={colors.warningSurface}
            iconColor={colors.warning}
            onPress={handleTestESP32}
            hasChevron={false}
          />
          <View style={styles.divider} />
          <SettingsItem
            icon="stop-circle-outline"
            title="ESP32 Testini Bitir"
            subtitle="Çalan test alarmını anında susturur"
            iconBg={colors.errorSurface}
            iconColor={colors.error}
            onPress={handleStopTestESP32}
            hasChevron={false}
          />
        </View>

        {/* Notifications Section */}
        <Text style={styles.sectionTitle}>Bildirim Tercihleri</Text>
        <View style={styles.settingsGroup}>
          <SettingsItem
            icon="notifications-outline"
            title="Anlık Bildirimler"
            hasSwitch
            switchValue={pushNotifs}
            onSwitchChange={setPushNotifs}
            hasChevron={false}
          />
          <View style={styles.divider} />
          <SettingsItem
            icon="volume-high-outline"
            title="Sesli Uyarılar"
            hasSwitch
            switchValue={soundAlerts}
            onSwitchChange={setSoundAlerts}
            hasChevron={false}
          />
          <View style={styles.divider} />
          <SettingsItem
            icon="timer-outline"
            title="Gecikme Süresi"
            subtitle={`${selectedDelay} dakika sonra uyar`}
            onPress={() => setDelaySheetVisible(true)}
          />
          <View style={styles.divider} />
          <SettingsItem
            icon="phone-portrait-outline"
            title="Titreşim"
            hasSwitch
            switchValue={vibration}
            onSwitchChange={setVibration}
            hasChevron={false}
          />
        </View>

        {/* App Section */}
        <Text style={styles.sectionTitle}>Uygulama</Text>
        <View style={styles.settingsGroup}>
          <SettingsItem
            icon="color-palette-outline"
            title="Tema"
            subtitle={selectedTheme === 'light' ? 'Açık Mod' : 'Koyu Mod'}
            onPress={() => setThemeSheetVisible(true)}
          />
          <View style={styles.divider} />
          <SettingsItem
            icon="language-outline"
            title="Dil"
            subtitle={selectedLang === 'tr' ? 'Türkçe' : 'English'}
            onPress={() => setLangSheetVisible(true)}
          />
          <View style={styles.divider} />
          <SettingsItem
            icon="information-circle-outline"
            title="Hakkında"
            subtitle="CareSync v1.0.0"
            onPress={handleAbout}
          />
        </View>

        {/* Logout */}
        <View style={styles.settingsGroup}>
          <SettingsItem
            icon="log-out-outline"
            title="Çıkış Yap"
            iconBg={colors.accentSurface}
            iconColor={colors.accent}
            onPress={handleSignOut}
            danger
          />
        </View>

        {/* Version info */}
        <Text style={styles.versionText}>CareSync v1.0.0 • Akıllı İlaç Takip Sistemi</Text>
      </ScrollView>

      {/* Hasta Ekleme BottomSheet */}
      <BottomSheet
        visible={patientSheetVisible}
        onClose={() => setPatientSheetVisible(false)}
        title="Hasta Ekle"
      >
        <View style={styles.sheetBody}>
          <Text style={styles.sheetSubtitle}>
            Takip etmek istediğiniz hastanın kişisel bilgilerini giriniz.
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

          <View style={styles.flexRow}>
            <View style={[styles.flex1, { marginRight: spacing.md }]}>
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
            <View style={styles.flex2}>
              <Text style={styles.inputLabel}>Teşhis / Hastalık</Text>
              <TextInput
                style={styles.textInput}
                value={newPatientDiagnosis}
                onChangeText={setNewPatientDiagnosis}
                placeholder="Örn: Alzheimer, Hipertansiyon"
                placeholderTextColor={colors.textTertiary}
                editable={!savingPatient}
              />
            </View>
          </View>

          <Pressable
            style={[styles.saveBtn, savingPatient && { opacity: 0.7 }]}
            onPress={handleAddPatient}
            disabled={savingPatient}
          >
            {savingPatient ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.saveBtnText}>Kaydet ve Başla</Text>
            )}
          </Pressable>
        </View>
      </BottomSheet>

      {/* Profil Düzenleme BottomSheet */}
      <BottomSheet
        visible={profileSheetVisible}
        onClose={() => setProfileSheetVisible(false)}
        title="Profili Düzenle"
      >
        <View style={styles.sheetBody}>
          <Text style={styles.inputLabel}>Görünen İsim</Text>
          <TextInput
            style={styles.textInput}
            value={editDisplayName}
            onChangeText={setEditDisplayName}
            placeholder="Adınız Soyadınız"
            placeholderTextColor={colors.textTertiary}
            editable={!savingProfile}
          />
          <View style={styles.infoRow}>
            <Ionicons name="mail-outline" size={16} color={colors.textTertiary} />
            <Text style={styles.infoRowText}>{email}</Text>
          </View>

          <Pressable
            style={[styles.saveBtn, savingProfile && { opacity: 0.7 }]}
            onPress={handleSaveProfile}
            disabled={savingProfile}
          >
            {savingProfile ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.saveBtnText}>Güncelle</Text>
            )}
          </Pressable>
        </View>
      </BottomSheet>

      {/* Hasta Profili Düzenleme BottomSheet */}
      <BottomSheet
        visible={editPatientSheetVisible}
        onClose={() => setEditPatientSheetVisible(false)}
        title="Hasta Bilgilerini Düzenle"
      >
        <View style={styles.sheetBody}>
          <Text style={styles.inputLabel}>Hasta Adı Soyadı *</Text>
          <TextInput
            style={styles.textInput}
            value={editPatientName}
            onChangeText={setEditPatientName}
            placeholder="Hasta adı"
            placeholderTextColor={colors.textTertiary}
            editable={!savingEditPatient}
          />

          <View style={styles.flexRow}>
            <View style={[styles.flex1, { marginRight: spacing.md }]}>
              <Text style={styles.inputLabel}>Yaşı</Text>
              <TextInput
                style={styles.textInput}
                value={editPatientAge}
                onChangeText={setEditPatientAge}
                placeholder="Yaş"
                keyboardType="numeric"
                placeholderTextColor={colors.textTertiary}
                editable={!savingEditPatient}
              />
            </View>
            <View style={styles.flex2}>
              <Text style={styles.inputLabel}>Teşhis / Hastalık</Text>
              <TextInput
                style={styles.textInput}
                value={editPatientDiagnosis}
                onChangeText={setEditPatientDiagnosis}
                placeholder="Tanı bilgisi"
                placeholderTextColor={colors.textTertiary}
                editable={!savingEditPatient}
              />
            </View>
          </View>

          <Pressable
            style={[styles.saveBtn, savingEditPatient && { opacity: 0.7 }]}
            onPress={handleSaveEditPatient}
            disabled={savingEditPatient}
          >
            {savingEditPatient ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.saveBtnText}>Güncelle</Text>
            )}
          </Pressable>
        </View>
      </BottomSheet>

      {/* Acil Durum Kişisi Ekleme BottomSheet */}
      <BottomSheet
        visible={emergencySheetVisible}
        onClose={() => setEmergencySheetVisible(false)}
        title="Acil Durum Kişisi Ekle"
      >
        <View style={styles.sheetBody}>
          <Text style={styles.sheetSubtitle}>
            Acil durumda aranacak kişinin bilgilerini girin.
          </Text>

          <Text style={styles.inputLabel}>Ad Soyad *</Text>
          <TextInput
            style={styles.textInput}
            value={emergencyName}
            onChangeText={setEmergencyName}
            placeholder="Örn: Mehmet Yılmaz"
            placeholderTextColor={colors.textTertiary}
            editable={!savingEmergency}
          />

          <Text style={styles.inputLabel}>Telefon *</Text>
          <TextInput
            style={styles.textInput}
            value={emergencyPhone}
            onChangeText={setEmergencyPhone}
            placeholder="Örn: 0532 123 4567"
            keyboardType="phone-pad"
            placeholderTextColor={colors.textTertiary}
            editable={!savingEmergency}
          />

          <Text style={styles.inputLabel}>Yakınlık Derecesi</Text>
          <TextInput
            style={styles.textInput}
            value={emergencyRelation}
            onChangeText={setEmergencyRelation}
            placeholder="Örn: Oğlu, Komşu, Doktor"
            placeholderTextColor={colors.textTertiary}
            editable={!savingEmergency}
          />

          <Pressable
            style={[styles.saveBtn, savingEmergency && { opacity: 0.7 }]}
            onPress={handleSaveEmergency}
            disabled={savingEmergency}
          >
            {savingEmergency ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.saveBtnText}>Kişiyi Kaydet</Text>
            )}
          </Pressable>
        </View>
      </BottomSheet>

      {/* Cihaz Detay BottomSheet */}
      <BottomSheet
        visible={deviceSheetVisible}
        onClose={() => setDeviceSheetVisible(false)}
        title={deviceSheetType === 'box' ? 'İlaç Kutusu Detayı' : deviceSheetType === 'bracelet' ? 'Bileklik Detayı' : 'RF Bağlantısı Detayı'}
      >
        <View style={styles.sheetBody}>
          {deviceSheetType === 'box' && (
            <>
              <View style={styles.deviceDetailCard}>
                <View style={[styles.deviceDetailIconWrap, { backgroundColor: boxIconBg }]}>
                  <Ionicons name="cube" size={28} color={deviceStatus?.box?.status === 'online' ? colors.success : colors.accent} />
                </View>
                <Text style={styles.deviceDetailTitle}>ESP32 İlaç Kutusu</Text>
                <View style={styles.deviceDetailRow}>
                  <Text style={styles.deviceDetailLabel}>Durum:</Text>
                  <Text style={[styles.deviceDetailValue, { color: deviceStatus?.box?.status === 'online' ? colors.success : colors.accent }]}>
                    {deviceStatus?.box?.status === 'online' ? '● Çevrimiçi' : '○ Çevrimdışı'}
                  </Text>
                </View>
                <View style={styles.deviceDetailRow}>
                  <Text style={styles.deviceDetailLabel}>Sinyal:</Text>
                  <Text style={styles.deviceDetailValue}>
                    {deviceStatus?.box?.signalStrength === 'strong' ? 'Güçlü 📶' : deviceStatus?.box?.signalStrength === 'medium' ? 'Orta 📶' : 'Zayıf'}
                  </Text>
                </View>
                <View style={styles.deviceDetailRow}>
                  <Text style={styles.deviceDetailLabel}>Radyo Modül:</Text>
                  <Text style={styles.deviceDetailValue}>NRF24L01 (2.4GHz)</Text>
                </View>
                <View style={styles.deviceDetailRow}>
                  <Text style={styles.deviceDetailLabel}>LED:</Text>
                  <Text style={styles.deviceDetailValue}>GPIO 4</Text>
                </View>
                <View style={styles.deviceDetailRow}>
                  <Text style={styles.deviceDetailLabel}>Buzzer:</Text>
                  <Text style={styles.deviceDetailValue}>GPIO 46</Text>
                </View>
                <View style={styles.deviceDetailRow}>
                  <Text style={styles.deviceDetailLabel}>Buton:</Text>
                  <Text style={styles.deviceDetailValue}>GPIO 36</Text>
                </View>
                <View style={styles.deviceDetailRow}>
                  <Text style={styles.deviceDetailLabel}>NRF CE/CSN:</Text>
                  <Text style={styles.deviceDetailValue}>GPIO 15 / GPIO 16</Text>
                </View>
              </View>
            </>
          )}
          {deviceSheetType === 'bracelet' && (
            <>
              <View style={styles.deviceDetailCard}>
                <View style={[styles.deviceDetailIconWrap, { backgroundColor: braceletIconBg }]}>
                  <Ionicons name="watch" size={28} color={deviceStatus?.bracelet?.status === 'online' ? colors.success : colors.accent} />
                </View>
                <Text style={styles.deviceDetailTitle}>Bileklik (ESP32 Alıcı)</Text>
                <View style={styles.deviceDetailRow}>
                  <Text style={styles.deviceDetailLabel}>Durum:</Text>
                  <Text style={[styles.deviceDetailValue, { color: deviceStatus?.bracelet?.status === 'online' ? colors.success : colors.accent }]}>
                    {deviceStatus?.bracelet?.status === 'online' ? '● Çevrimiçi' : '○ Çevrimdışı'}
                  </Text>
                </View>
                <View style={styles.deviceDetailRow}>
                  <Text style={styles.deviceDetailLabel}>Pil Seviyesi:</Text>
                  <Text style={styles.deviceDetailValue}>%{deviceStatus?.bracelet?.batteryLevel || 0}</Text>
                </View>
                <View style={styles.deviceDetailRow}>
                  <Text style={styles.deviceDetailLabel}>Radyo Modül:</Text>
                  <Text style={styles.deviceDetailValue}>NRF24L01 (2.4GHz RX)</Text>
                </View>
                <View style={styles.deviceDetailRow}>
                  <Text style={styles.deviceDetailLabel}>LED:</Text>
                  <Text style={styles.deviceDetailValue}>GPIO 4</Text>
                </View>
                <View style={styles.deviceDetailRow}>
                  <Text style={styles.deviceDetailLabel}>Buzzer:</Text>
                  <Text style={styles.deviceDetailValue}>GPIO 46</Text>
                </View>
                <View style={styles.deviceDetailRow}>
                  <Text style={styles.deviceDetailLabel}>Buton:</Text>
                  <Text style={styles.deviceDetailValue}>GPIO 36</Text>
                </View>
              </View>
            </>
          )}
          {deviceSheetType === 'rf' && (
            <>
              <View style={styles.deviceDetailCard}>
                <View style={[styles.deviceDetailIconWrap, { backgroundColor: colors.infoSurface }]}>
                  <Ionicons name="radio-outline" size={28} color={colors.info} />
                </View>
                <Text style={styles.deviceDetailTitle}>NRF24L01 Haberleşme</Text>
                <View style={styles.deviceDetailRow}>
                  <Text style={styles.deviceDetailLabel}>Frekans:</Text>
                  <Text style={styles.deviceDetailValue}>2.4 GHz</Text>
                </View>
                <View style={styles.deviceDetailRow}>
                  <Text style={styles.deviceDetailLabel}>Protokol:</Text>
                  <Text style={styles.deviceDetailValue}>SPI + RF24 Kütüphanesi</Text>
                </View>
                <View style={styles.deviceDetailRow}>
                  <Text style={styles.deviceDetailLabel}>Hız:</Text>
                  <Text style={styles.deviceDetailValue}>250 kbps</Text>
                </View>
                <View style={styles.deviceDetailRow}>
                  <Text style={styles.deviceDetailLabel}>CE Pin:</Text>
                  <Text style={styles.deviceDetailValue}>GPIO 15</Text>
                </View>
                <View style={styles.deviceDetailRow}>
                  <Text style={styles.deviceDetailLabel}>CSN Pin:</Text>
                  <Text style={styles.deviceDetailValue}>GPIO 16</Text>
                </View>
                <View style={styles.deviceDetailRow}>
                  <Text style={styles.deviceDetailLabel}>SCK/MOSI/MISO:</Text>
                  <Text style={styles.deviceDetailValue}>GPIO 7 / 5 / 6</Text>
                </View>
                <View style={styles.deviceDetailRow}>
                  <Text style={styles.deviceDetailLabel}>Menzil:</Text>
                  <Text style={styles.deviceDetailValue}>~100m (açık alan)</Text>
                </View>
              </View>
            </>
          )}
        </View>
      </BottomSheet>

      {/* Gecikme Süresi BottomSheet */}
      <BottomSheet
        visible={delaySheetVisible}
        onClose={() => setDelaySheetVisible(false)}
        title="Gecikme Süresi"
      >
        <View style={styles.sheetBody}>
          <Text style={styles.sheetSubtitle}>
            İlaç alınmadığında kaç dakika sonra tekrar uyarı gönderilsin?
          </Text>
          {delayOptions.map((opt) => (
            <Pressable
              key={opt.value}
              style={[styles.selectOption, selectedDelay === opt.value && styles.selectOptionActive]}
              onPress={() => {
                setSelectedDelay(opt.value);
                setDelaySheetVisible(false);
              }}
            >
              <Text style={[styles.selectOptionText, selectedDelay === opt.value && styles.selectOptionTextActive]}>
                {opt.label}
              </Text>
              {selectedDelay === opt.value && (
                <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
              )}
            </Pressable>
          ))}
        </View>
      </BottomSheet>

      {/* Tema BottomSheet */}
      <BottomSheet
        visible={themeSheetVisible}
        onClose={() => setThemeSheetVisible(false)}
        title="Tema Seçimi"
      >
        <View style={styles.sheetBody}>
          {[
            { value: 'light', label: 'Açık Mod', icon: 'sunny-outline' },
            { value: 'dark', label: 'Koyu Mod', icon: 'moon-outline' },
          ].map((opt) => (
            <Pressable
              key={opt.value}
              style={[styles.selectOption, selectedTheme === opt.value && styles.selectOptionActive]}
              onPress={() => {
                setSelectedTheme(opt.value);
                setThemeSheetVisible(false);
                if (opt.value === 'dark') {
                  Alert.alert('Bilgi', 'Koyu mod desteği gelecek güncellemede aktif edilecektir. Tercihiniz kaydedildi.');
                }
              }}
            >
              <View style={styles.selectOptionLeft}>
                <Ionicons name={opt.icon} size={20} color={selectedTheme === opt.value ? colors.primary : colors.textSecondary} />
                <Text style={[styles.selectOptionText, selectedTheme === opt.value && styles.selectOptionTextActive]}>
                  {opt.label}
                </Text>
              </View>
              {selectedTheme === opt.value && (
                <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
              )}
            </Pressable>
          ))}
        </View>
      </BottomSheet>

      {/* Dil BottomSheet */}
      <BottomSheet
        visible={langSheetVisible}
        onClose={() => setLangSheetVisible(false)}
        title="Dil Seçimi"
      >
        <View style={styles.sheetBody}>
          {[
            { value: 'tr', label: 'Türkçe', flag: '🇹🇷' },
            { value: 'en', label: 'English', flag: '🇬🇧' },
          ].map((opt) => (
            <Pressable
              key={opt.value}
              style={[styles.selectOption, selectedLang === opt.value && styles.selectOptionActive]}
              onPress={() => {
                setSelectedLang(opt.value);
                setLangSheetVisible(false);
                if (opt.value === 'en') {
                  Alert.alert('Info', 'English language support will be available in the next update. Your preference has been saved.');
                }
              }}
            >
              <View style={styles.selectOptionLeft}>
                <Text style={{ fontSize: 20 }}>{opt.flag}</Text>
                <Text style={[styles.selectOptionText, selectedLang === opt.value && styles.selectOptionTextActive]}>
                  {opt.label}
                </Text>
              </View>
              {selectedLang === opt.value && (
                <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
              )}
            </Pressable>
          ))}
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: Platform.OS === 'android' ? spacing.xxxxl + 8 : spacing.xxxl,
    paddingBottom: 100,
  },
  title: { ...typography.headlineLarge, color: colors.textPrimary, marginBottom: spacing.xxl },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background, gap: spacing.lg },
  loadingText: { ...typography.bodyMedium, color: colors.textSecondary },
  profileCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: borderRadius.lg, padding: spacing.xl, marginBottom: spacing.xxl, ...shadows.md },
  profileAvatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', marginRight: spacing.lg },
  profileInitials: { ...typography.titleLarge, color: colors.textOnPrimary },
  profileInfo: { flex: 1 },
  profileName: { ...typography.headlineSmall, color: colors.textPrimary },
  profileEmail: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  editBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primarySurface, justifyContent: 'center', alignItems: 'center' },
  sectionTitle: { ...typography.titleMedium, color: colors.textSecondary, marginBottom: spacing.md, marginTop: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  settingsGroup: { backgroundColor: colors.surface, borderRadius: borderRadius.lg, marginBottom: spacing.xl, ...shadows.sm },
  settingsItem: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg },
  settingsIcon: { width: 40, height: 40, borderRadius: borderRadius.md, justifyContent: 'center', alignItems: 'center', marginRight: spacing.lg },
  settingsContent: { flex: 1 },
  settingsTitle: { ...typography.titleMedium, color: colors.textPrimary },
  settingsSubtitle: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.borderLight, marginLeft: 72 },
  versionText: { ...typography.bodySmall, color: colors.textTertiary, textAlign: 'center', marginTop: spacing.lg, marginBottom: spacing.xxxl },
  
  // Sheet Styles
  sheetBody: { paddingBottom: spacing.xl },
  sheetSubtitle: { ...typography.bodyMedium, color: colors.textSecondary, marginBottom: spacing.xl },
  flexRow: { flexDirection: 'row', alignItems: 'flex-start' },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
  inputLabel: { ...typography.labelLarge, color: colors.textPrimary, marginBottom: spacing.sm },
  textInput: { backgroundColor: colors.surfaceVariant, borderRadius: borderRadius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, ...typography.bodyLarge, color: colors.textPrimary, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, paddingVertical: spacing.lg, borderRadius: borderRadius.md, gap: spacing.sm, ...shadows.md, marginTop: spacing.sm },
  saveBtnText: { ...typography.titleMedium, color: colors.textOnPrimary },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceVariant, padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.lg },
  infoRowText: { ...typography.bodyMedium, color: colors.textSecondary },

  // Device Detail
  deviceDetailCard: { backgroundColor: colors.surfaceVariant, borderRadius: borderRadius.lg, padding: spacing.xl, alignItems: 'center' },
  deviceDetailIconWrap: { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.md },
  deviceDetailTitle: { ...typography.headlineSmall, color: colors.textPrimary, marginBottom: spacing.xl },
  deviceDetailRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  deviceDetailLabel: { ...typography.bodyMedium, color: colors.textSecondary },
  deviceDetailValue: { ...typography.titleMedium, color: colors.textPrimary },

  // Select options
  selectOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg, backgroundColor: colors.surfaceVariant, borderRadius: borderRadius.md, marginBottom: spacing.sm },
  selectOptionActive: { backgroundColor: colors.primarySurface, borderWidth: 2, borderColor: colors.primary },
  selectOptionLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  selectOptionText: { ...typography.titleMedium, color: colors.textPrimary },
  selectOptionTextActive: { color: colors.primary, fontWeight: '700' },
});

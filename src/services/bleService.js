/*
 * CareSync – BLE Servis Modülü (React Native)
 * 
 * ESP32-S3 Bileklik ile BLE 5.0 üzerinden iletişim.
 * Fonksiyonlar:
 *   - Bileklik tarama ve bağlantı
 *   - Pil seviyesi okuma (gerçek zamanlı)
 *   - Şarj durumu takibi
 *   - Alarm tetikleme / durdurma
 *   - İlaç onay bildirimi alma
 */

import { Platform, PermissionsAndroid, Alert } from 'react-native';

// BLE UUID'leri (ESP32 firmware ile aynı!)
const BLE_SERVICE_UUID        = '12345678-1234-5678-1234-56789abcdef0';
const BLE_CHAR_BATTERY_UUID   = '12345678-1234-5678-1234-56789abcdef1';
const BLE_CHAR_CHARGE_UUID    = '12345678-1234-5678-1234-56789abcdef2';
const BLE_CHAR_ALARM_UUID     = '12345678-1234-5678-1234-56789abcdef3';
const BLE_CHAR_MEDICINE_UUID  = '12345678-1234-5678-1234-56789abcdef4';
const BLE_CHAR_DEVICE_INFO_UUID = '12345678-1234-5678-1234-56789abcdef5';

const DEVICE_NAME = 'CareSync-Band';

// BLE durumu (Native)
let manager = null;
let connectedDevice = null;
let isScanning = false;

// BLE durumu (Web)
let webDevice = null;
let webGattServer = null;

// Callback'ler
let onBatteryUpdate = null;
let onChargeUpdate = null;
let onAlarmUpdate = null;
let onMedicineConfirm = null;
let onConnectionChange = null;

/**
 * Android BLE izinlerini iste
 */
async function requestBLEPermissions() {
  if (Platform.OS !== 'android') return true;

  try {
    const apiLevel = Platform.Version;
    
    if (apiLevel >= 31) {
      // Android 12+ (API 31+)
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      
      return Object.values(results).every(
        r => r === PermissionsAndroid.RESULTS.GRANTED
      );
    } else {
      // Android 11 ve altı
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      return result === PermissionsAndroid.RESULTS.GRANTED;
    }
  } catch (err) {
    console.error('[BLE] İzin hatası:', err);
    return false;
  }
}

/**
 * BLE Manager'ı başlat
 */
async function initBLE() {
  try {
    // react-native-ble-plx'i dinamik olarak yükle
    // Eğer kütüphane yüklü değilse hata vermeden devam et
    const { BleManager } = require('react-native-ble-plx');
    manager = new BleManager();
    console.log('[BLE] Manager başlatıldı.');
    return true;
  } catch (error) {
    console.warn('[BLE] react-native-ble-plx yüklenemedi. BLE devre dışı:', error.message);
    manager = null;
    return false;
  }
}

/**
 * Bileklik cihazını tara
 * @param {number} timeoutMs - Tarama süresi (ms)
 * @param {function} onDeviceFound - Cihaz bulunduğunda çağrılır
 * @returns {Promise<object|null>} Bulunan cihaz veya null
 */
export async function scanForWristband(timeoutMs = 10000, onDeviceFound = null) {
  if (!manager) {
    const ok = await initBLE();
    if (!ok) return null;
  }

  // İzinleri kontrol et
  const hasPermission = await requestBLEPermissions();
  if (!hasPermission) {
    Alert.alert('İzin Gerekli', 'Bluetooth bağlantısı için izin vermeniz gerekiyor.');
    return null;
  }

  // Bluetooth açık mı kontrol et
  const state = await manager.state();
  if (state !== 'PoweredOn') {
    Alert.alert('Bluetooth Kapalı', 'Lütfen Bluetooth\'u açın.');
    return null;
  }

  return new Promise((resolve) => {
    isScanning = true;
    let found = null;

    console.log('[BLE] Tarama başlıyor...');

    // Timeout
    const timeout = setTimeout(() => {
      manager.stopDeviceScan();
      isScanning = false;
      console.log('[BLE] Tarama süresi doldu.');
      resolve(found);
    }, timeoutMs);

    // Tarama başlat
    manager.startDeviceScan(
      [BLE_SERVICE_UUID], // Sadece CareSync servisli cihazları filtrele
      { allowDuplicates: false },
      (error, device) => {
        if (error) {
          console.error('[BLE] Tarama hatası:', error);
          clearTimeout(timeout);
          isScanning = false;
          resolve(null);
          return;
        }

        if (device && (device.name === DEVICE_NAME || device.localName === DEVICE_NAME)) {
          console.log(`[BLE] Bileklik bulundu! ID: ${device.id}, RSSI: ${device.rssi}`);
          
          if (onDeviceFound) onDeviceFound(device);
          
          clearTimeout(timeout);
          manager.stopDeviceScan();
          isScanning = false;
          found = device;
          resolve(device);
        }
      }
    );
  });
}

/**
 * Bulunan cihaza bağlan
 * @param {object} device - BLE cihaz objesi
 * @returns {Promise<boolean>}
 */
export async function connectToWristband(device) {
  if (!manager || !device) return false;

  try {
    console.log('[BLE] Bağlanıyor...');
    
    // Bağlan
    const connected = await device.connect({ timeout: 5000 });
    
    // Servis ve karakteristikleri keşfet
    await connected.discoverAllServicesAndCharacteristics();
    
    connectedDevice = connected;
    console.log('[BLE] ✅ Bağlantı başarılı!');

    // Bağlantı durumu değişikliğini dinle
    connected.onDisconnected((error, disconnectedDevice) => {
      console.log('[BLE] Bağlantı koptu.');
      connectedDevice = null;
      if (onConnectionChange) onConnectionChange(false);
    });

    if (onConnectionChange) onConnectionChange(true);

    // Bildirimleri başlat
    await startNotifications();

    // İlk değerleri oku
    await readInitialValues();

    return true;
  } catch (error) {
    console.error('[BLE] Bağlantı hatası:', error);
    connectedDevice = null;
    return false;
  }
}

/**
 * Bileklikten bağlantıyı kes
 */
export async function disconnectWristband() {
  if (Platform.OS === 'web') {
    if (webDevice && webDevice.gatt.connected) {
      webDevice.gatt.disconnect();
    }
    webGattServer = null;
    webDevice = null;
    if (onConnectionChange) onConnectionChange(false);
    return;
  }

  if (connectedDevice) {
    try {
      await connectedDevice.cancelConnection();
    } catch (e) {
      // Zaten kopmuş olabilir
    }
    connectedDevice = null;
    if (onConnectionChange) onConnectionChange(false);
  }
}

/**
 * Tara ve bağlan (tek fonksiyon)
 */
export async function scanAndConnect(onStatusUpdate = null) {
  if (Platform.OS === 'web') {
    return await connectWebBluetooth(onStatusUpdate);
  }

  if (onStatusUpdate) onStatusUpdate('scanning');
  
  const device = await scanForWristband(10000);
  
  if (!device) {
    if (onStatusUpdate) onStatusUpdate('not_found');
    return false;
  }

  if (onStatusUpdate) onStatusUpdate('connecting');
  
  const success = await connectToWristband(device);
  
  if (success) {
    if (onStatusUpdate) onStatusUpdate('connected');
  } else {
    if (onStatusUpdate) onStatusUpdate('failed');
  }
  
  return success;
}

/**
 * BLE bildirimlerini başlat (pil, şarj, alarm, ilaç onay)
 */
async function startNotifications() {
  if (!connectedDevice) return;

  try {
    // Pil seviyesi bildirimi
    connectedDevice.monitorCharacteristicForService(
      BLE_SERVICE_UUID,
      BLE_CHAR_BATTERY_UUID,
      (error, characteristic) => {
        if (error) return;
        if (characteristic?.value) {
          const bytes = base64ToBytes(characteristic.value);
          const batteryLevel = bytes[0];
          console.log(`[BLE] 🔋 Pil: ${batteryLevel}%`);
          if (onBatteryUpdate) onBatteryUpdate(batteryLevel);
        }
      }
    );

    // Şarj durumu bildirimi
    connectedDevice.monitorCharacteristicForService(
      BLE_SERVICE_UUID,
      BLE_CHAR_CHARGE_UUID,
      (error, characteristic) => {
        if (error) return;
        if (characteristic?.value) {
          const bytes = base64ToBytes(characteristic.value);
          const chargeState = bytes[0]; // 0=yok, 1=şarj, 2=tam
          console.log(`[BLE] ⚡ Şarj: ${chargeState}`);
          if (onChargeUpdate) onChargeUpdate(chargeState);
        }
      }
    );

    // Alarm durumu bildirimi
    connectedDevice.monitorCharacteristicForService(
      BLE_SERVICE_UUID,
      BLE_CHAR_ALARM_UUID,
      (error, characteristic) => {
        if (error) return;
        if (characteristic?.value) {
          const bytes = base64ToBytes(characteristic.value);
          const alarmActive = bytes[0] === 1;
          console.log(`[BLE] 🔔 Alarm: ${alarmActive ? 'AKTİF' : 'Kapalı'}`);
          if (onAlarmUpdate) onAlarmUpdate(alarmActive);
        }
      }
    );

    // İlaç onay bildirimi
    connectedDevice.monitorCharacteristicForService(
      BLE_SERVICE_UUID,
      BLE_CHAR_MEDICINE_UUID,
      (error, characteristic) => {
        if (error) return;
        if (characteristic?.value) {
          console.log('[BLE] 💊 İlaç onay bildirimi alındı!');
          if (onMedicineConfirm) onMedicineConfirm();
        }
      }
    );

    console.log('[BLE] Bildirimler başlatıldı.');
  } catch (error) {
    console.error('[BLE] Bildirim başlatma hatası:', error);
  }
}

/**
 * İlk değerleri oku
 */
async function readInitialValues() {
  if (!connectedDevice) return;

  try {
    // Pil seviyesi
    const batteryChar = await connectedDevice.readCharacteristicForService(
      BLE_SERVICE_UUID,
      BLE_CHAR_BATTERY_UUID
    );
    if (batteryChar?.value) {
      const bytes = base64ToBytes(batteryChar.value);
      if (onBatteryUpdate) onBatteryUpdate(bytes[0]);
    }

    // Şarj durumu
    const chargeChar = await connectedDevice.readCharacteristicForService(
      BLE_SERVICE_UUID,
      BLE_CHAR_CHARGE_UUID
    );
    if (chargeChar?.value) {
      const bytes = base64ToBytes(chargeChar.value);
      if (onChargeUpdate) onChargeUpdate(bytes[0]);
    }
  } catch (error) {
    console.error('[BLE] İlk okuma hatası:', error);
  }
}

/**
 * Bilekliğe alarm komutu gönder
 * @param {boolean} activate - true=alarm başlat, false=alarm durdur
 */
export async function sendAlarmCommand(activate) {
  if (Platform.OS === 'web') {
    if (!webGattServer) return false;
    try {
      const service = await webGattServer.getPrimaryService(BLE_SERVICE_UUID);
      const char = await service.getCharacteristic(BLE_CHAR_ALARM_UUID);
      await char.writeValue(new Uint8Array([activate ? 1 : 0]));
      console.log(`[BLE-WEB] Alarm komutu gönderildi: ${activate ? 'AKTİF' : 'DURDUR'}`);
      return true;
    } catch (e) {
      console.error('[BLE-WEB] Alarm gönderme hatası:', e);
      return false;
    }
  }

  if (!connectedDevice) {
    console.warn('[BLE] Cihaz bağlı değil, alarm gönderilemedi.');
    return false;
  }

  try {
    const value = bytesToBase64([activate ? 1 : 0]);
    await connectedDevice.writeCharacteristicWithResponseForService(
      BLE_SERVICE_UUID,
      BLE_CHAR_ALARM_UUID,
      value
    );
    console.log(`[BLE] Alarm komutu gönderildi: ${activate ? 'AKTİF' : 'DURDUR'}`);
    return true;
  } catch (error) {
    console.error('[BLE] Alarm gönderme hatası:', error);
    return false;
  }
}

/**
 * Cihaz bilgisini oku
 */
export async function readDeviceInfo() {
  if (!connectedDevice) return null;

  try {
    const char = await connectedDevice.readCharacteristicForService(
      BLE_SERVICE_UUID,
      BLE_CHAR_DEVICE_INFO_UUID
    );
    if (char?.value) {
      const text = base64ToString(char.value);
      return JSON.parse(text);
    }
  } catch (error) {
    console.error('[BLE] Cihaz bilgisi okuma hatası:', error);
  }
  return null;
}

/**
 * Bağlantı durumunu kontrol et
 */
export function isConnected() {
  if (Platform.OS === 'web') {
    return webGattServer !== null;
  }
  return connectedDevice !== null;
}

/**
 * Tarama durumunu kontrol et
 */
export function isScanningNow() {
  return isScanning;
}

/**
 * Callback'leri ayarla
 */
export function setCallbacks({ onBattery, onCharge, onAlarm, onMedicine, onConnection }) {
  if (onBattery) onBatteryUpdate = onBattery;
  if (onCharge) onChargeUpdate = onCharge;
  if (onAlarm) onAlarmUpdate = onAlarm;
  if (onMedicine) onMedicineConfirm = onMedicine;
  if (onConnection) onConnectionChange = onConnection;
}

/**
 * BLE temizlik (uygulama kapanırken çağır)
 */
export function cleanup() {
  if (Platform.OS === 'web') {
    if (webDevice && webDevice.gatt.connected) {
      webDevice.gatt.disconnect();
    }
    webGattServer = null;
    webDevice = null;
    return;
  }

  if (connectedDevice) {
    try { connectedDevice.cancelConnection(); } catch (e) {}
  }
  if (manager) {
    manager.destroy();
    manager = null;
  }
}

// ── Web Bluetooth Fonksiyonları ──────────────────────────────

async function connectWebBluetooth(onStatusUpdate) {
  try {
    if (!navigator.bluetooth) {
      alert('Tarayıcınız Web Bluetooth desteklemiyor. Lütfen Chrome, Edge veya uyumlu bir tarayıcı kullanın.');
      if (onStatusUpdate) onStatusUpdate('failed');
      return false;
    }

    if (onStatusUpdate) onStatusUpdate('scanning');
    
    webDevice = await navigator.bluetooth.requestDevice({
      filters: [{ services: [BLE_SERVICE_UUID] }],
      optionalServices: [BLE_SERVICE_UUID]
    });

    if (onStatusUpdate) onStatusUpdate('connecting');

    webDevice.addEventListener('gattserverdisconnected', () => {
      console.log('[BLE-WEB] Bağlantı koptu.');
      webGattServer = null;
      webDevice = null;
      if (onConnectionChange) onConnectionChange(false);
    });

    webGattServer = await webDevice.gatt.connect();
    console.log('[BLE-WEB] ✅ GATT Bağlantısı başarılı!');

    if (onConnectionChange) onConnectionChange(true);

    const service = await webGattServer.getPrimaryService(BLE_SERVICE_UUID);

    // Karakteristikleri ayarla
    await setupWebCharacteristic(service, BLE_CHAR_BATTERY_UUID, (val) => {
      const level = val.getUint8(0);
      console.log(`[BLE-WEB] 🔋 Pil: ${level}%`);
      if (onBatteryUpdate) onBatteryUpdate(level);
    });

    await setupWebCharacteristic(service, BLE_CHAR_CHARGE_UUID, (val) => {
      const state = val.getUint8(0);
      console.log(`[BLE-WEB] ⚡ Şarj: ${state}`);
      if (onChargeUpdate) onChargeUpdate(state);
    });

    await setupWebCharacteristic(service, BLE_CHAR_ALARM_UUID, (val) => {
      const active = val.getUint8(0) === 1;
      console.log(`[BLE-WEB] 🔔 Alarm: ${active ? 'AKTİF' : 'Kapalı'}`);
      if (onAlarmUpdate) onAlarmUpdate(active);
    });

    await setupWebCharacteristic(service, BLE_CHAR_MEDICINE_UUID, (val) => {
      console.log('[BLE-WEB] 💊 İlaç onay bildirimi alındı!');
      if (onMedicineConfirm) onMedicineConfirm();
    });

    if (onStatusUpdate) onStatusUpdate('connected');
    return true;

  } catch (error) {
    console.error('[BLE-WEB] Web Bluetooth hatası:', error);
    webGattServer = null;
    webDevice = null;
    if (onStatusUpdate) onStatusUpdate('failed');
    return false;
  }
}

async function setupWebCharacteristic(service, uuid, onRead) {
  try {
    const char = await service.getCharacteristic(uuid);
    await char.startNotifications();
    char.addEventListener('characteristicvaluechanged', (event) => {
      onRead(event.target.value);
    });
    // İlk değeri oku
    const initialVal = await char.readValue();
    onRead(initialVal);
  } catch (e) {
    console.warn(`[BLE-WEB] Karakteristik okunamadı: ${uuid}`, e);
  }
}

// ── Yardımcı Fonksiyonlar ──────────────────────────────

function base64ToBytes(base64) {
  // React Native'de atob yoksa basit decode
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (e) {
    // Fallback: Buffer kullan
    try {
      const buffer = Buffer.from(base64, 'base64');
      return new Uint8Array(buffer);
    } catch (e2) {
      return new Uint8Array([0]);
    }
  }
}

function bytesToBase64(bytes) {
  try {
    const binary = String.fromCharCode(...bytes);
    return btoa(binary);
  } catch (e) {
    try {
      return Buffer.from(bytes).toString('base64');
    } catch (e2) {
      return '';
    }
  }
}

function base64ToString(base64) {
  try {
    return atob(base64);
  } catch (e) {
    try {
      return Buffer.from(base64, 'base64').toString('utf8');
    } catch (e2) {
      return '';
    }
  }
}

export default {
  scanForWristband,
  connectToWristband,
  disconnectWristband,
  scanAndConnect,
  sendAlarmCommand,
  readDeviceInfo,
  isConnected,
  isScanningNow,
  setCallbacks,
  cleanup,
};

/*
 * =========================================================
 *  CareSync – ESP32-S3 Bileklik Firmware v2.0
 *  Kart: ESP32-S3 DevKitC / ESP32-S3-WROOM-1
 *
 *  Özellikler:
 *    ✅ 2x Titreşim motoru ile alarm bildirimi
 *    ✅ NRF24L01 ile ilaç kutusu haberleşmesi (RX + TX)
 *    ✅ BLE 5.0 ile mobil uygulama bağlantısı
 *    ✅ 550mAh Li-Ion pil (13400Q3) + TP4056 şarj yönetimi
 *    ✅ ADC ile pil seviyesi ölçümü
 *    ✅ Deep Sleep güç tasarrufu
 *    ✅ Buton ile ilaç onayı
 *
 *  Donanım:
 *    Titreşim Motoru     → GPIO 4 (2N2222A + 330Ω üzerinden)
 *    Buton               → GPIO 6 (INPUT_PULLUP)
 *    Durum LED           → GPIO 38
 *    Pil ADC             → GPIO 1 (voltaj bölücü: 100k/100k)
 *    TP4056 CHRG          → GPIO 7 (INPUT_PULLUP)
 *    TP4056 STDBY         → GPIO 8 (INPUT_PULLUP)
 *    NRF24L01 SPI        → MOSI:11 MISO:13 SCK:12 CE:10 CSN:9
 *    BLE                 → Dahili (ESP32-S3)
 *
 *  Yapı:
 *    config.h        → Pin ve sabit tanımları
 *    power_manager.h → Pil & şarj yönetimi
 *    nrf_comm.h      → NRF24L01 haberleşme
 *    ble_service.h   → BLE server (app bağlantısı)
 * =========================================================
 */

#include "ble_service.h"
#include "config.h"
#include "nrf_comm.h"
#include "power_manager.h"
#include "firebase_sync.h"

/* ─── Modül Örnekleri ────────────────────────────────────── */
PowerManager power;
NRFComm nrf;
CareSyncBLE ble;
FirebaseSync firebase;

/* ─── Durum Değişkenleri ─────────────────────────────────── */
bool alarmActive = false;
uint8_t alarmType = 0;
bool buttonPressed = false;
bool vibrateState = false;

/* ─── Zamanlama ──────────────────────────────────────────── */
unsigned long lastBatteryCheck = 0;
unsigned long lastBLENotify = 0;
unsigned long lastNRFCheck = 0;
unsigned long lastVibrateToggle = 0;
unsigned long lastActivityTime = 0; // Son aktivite zamanı (deep sleep için)
unsigned long alarmStartTime = 0;   // Alarm başlangıç zamanı
unsigned long lastFirebaseSync = 0; // Son Firebase senkronizasyonu

/* ─── Fonksiyon Bildirimleri ─────────────────────────────── */
void triggerAlarm(uint8_t type);
void stopAlarm();

void onFirebaseAlarmTrigger() {
  if (!alarmActive) {
    DEBUG_PRINTLN("[FIREBASE] Buluttan alarm tetiklendi!");
    triggerAlarm(ALARM_TYPE_APP_TRIGGER);
  }
}

void onFirebaseAlarmStop() {
  if (alarmActive) {
    DEBUG_PRINTLN("[FIREBASE] Buluttan alarm durdurma komutu geldi!");
    stopAlarm();
  }
}

/* ─── Alarm Deseni ───────────────────────────────────────── */
// Titreşim deseni: [on_ms, off_ms, on_ms, off_ms, ...]
// İlaç alarmı: Güçlü, ritmik titreşim
uint8_t alarmPatternIndex = 0;
uint8_t alarmRepeatCount = 0;
bool inAlarmPause = false;

/* ─────────────────────────────────────────────────────────
   SETUP
   ───────────────────────────────────────────────────────── */
void setup() {
  Serial.begin(SERIAL_BAUD_RATE);
  delay(200);

  DEBUG_PRINTLN("\n╔══════════════════════════════════════╗");
  DEBUG_PRINTLN("║   CareSync Bileklik v2.2 Başlıyor   ║");
  DEBUG_PRINTLN("╚══════════════════════════════════════╝");

  // ── Pin Kurulumu ──
  pinMode(VIBRO_MOTOR_PIN, OUTPUT);
  pinMode(STATUS_LED_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(BOOT_BUTTON_PIN, INPUT_PULLUP);

  // Tüm çıkışları kapat
  stopAllOutputs();

  // ── Modülleri Başlat ──
  DEBUG_PRINTLN("\n── Modüller Başlatılıyor ──");

  // 1. Güç Yönetimi
  power.begin();

  // 2. Kritik pil kontrolü: Çok düşükse hemen uyu
  //    USB güç algılandıysa bu adımı atla!
  if (!power.isUsbPowered && power.shouldShutdown()) {
    DEBUG_PRINTLN("[!] Pil kritik düzeyde! Deep Sleep'e geçiliyor...");
    criticalBatteryWarning();
    power.enterDeepSleep();
    return; // Asla buraya gelmez
  } else if (power.isUsbPowered) {
    DEBUG_PRINTLN("[✓] USB güç modu – pil kontrolü atlandı.");
  }

  // 3. NRF24L01
  if (nrf.begin()) {
    // Mesaj callback'i ayarla
    nrf.onMedicineAlert(onMedicineAlertReceived);
  }

  // 4. BLE Servisi (NRF24'ten sonra biraz bekle – bellek çakışmasını önle)
  delay(100);
  ble.begin();
  ble.onAlarmCommand(onBLEAlarmCommand);

  // 5. Firebase
  firebase.begin();
  firebase.onAlarmTrigger(onFirebaseAlarmTrigger);
  firebase.onAlarmStop(onFirebaseAlarmStop);

  // İlk durum güncellemesi
  ble.updateBatteryLevel(power.batteryPercent);
  ble.updateChargeState(power.chargeState);

  // ── Başlangıç Testi ──
  startupFeedback();

  lastActivityTime = millis();

  DEBUG_PRINTLN("\n══ Sistem Hazır ══");
  DEBUG_PRINTF("Güç Modu: %s\n", power.isUsbPowered ? "⚡ USB" : "🔋 Pil");
  DEBUG_PRINTF("Pil: %d%% (%.2fV) | Şarj: %s\n", power.batteryPercent,
               power.batteryVoltage,
               power.chargeState == 1   ? "Oluyor"
               : power.chargeState == 2 ? "Tam"
                                        : "Hayır");
  DEBUG_PRINTF("NRF24: %s | BLE: %s\n", nrf.isReady ? "✅" : "❌",
               "✅ Yayında");
  DEBUG_PRINTF("Deep Sleep: %s\n", 
               (power.isUsbPowered && DISABLE_DEEP_SLEEP_ON_USB) ? "❌ Devre Dışı" : "✅ Aktif");
}

/* ─────────────────────────────────────────────────────────
   LOOP
   ───────────────────────────────────────────────────────── */
void loop() {
  unsigned long now = millis();

  // ══════════════════════════════════════════════════════
  // 1. ALARM YÖNETİMİ (en yüksek öncelik)
  // ══════════════════════════════════════════════════════
  if (alarmActive) {
    handleAlarmVibration(now);
    lastActivityTime = now;
  }

  // ══════════════════════════════════════════════════════
  // 2. BUTON KONTROLÜ
  // ══════════════════════════════════════════════════════
  handleButton(now);

  // ══════════════════════════════════════════════════════
  // 3. NRF24L01 MESAJ KONTROLÜ
  // ══════════════════════════════════════════════════════
  if (nrf.isReady && (now - lastNRFCheck >= NRF_CHECK_INTERVAL)) {
    lastNRFCheck = now;
    nrf.checkForMessages();
  }

  // ══════════════════════════════════════════════════════
  // 4. PİL KONTROLÜ (periyodik)
  // ══════════════════════════════════════════════════════
  if (now - lastBatteryCheck >= BATTERY_CHECK_INTERVAL) {
    lastBatteryCheck = now;
    power.update();

    // Kritik pil → deep sleep (USB güçte atla!)
    if (!power.isUsbPowered && power.shouldShutdown()) {
      DEBUG_PRINTLN("[!] Pil kritik! Kapatılıyor...");
      stopAlarm();
      ble.updateBatteryLevel(0);
      delay(500);
      ble.stop();
      nrf.powerDown();
      power.enterDeepSleep();
      return;
    }

    // Düşük pil uyarısı (tek kısa titreşim)
    if (power.isLowBattery && !alarmActive) {
      lowBatteryBuzz();
    }

    DEBUG_PRINTF("[DURUM] Pil: %d%% (%.2fV) | Şarj: %d | BLE: %s\n",
                 power.batteryPercent, power.batteryVoltage, power.chargeState,
                 ble.isConnected ? "Bağlı" : "Yayında");
  }

  // ══════════════════════════════════════════════════════
  // 5. BLE GÜNCELLEMELERİ (periyodik)
  // ══════════════════════════════════════════════════════
  if (now - lastBLENotify >= BLE_NOTIFY_INTERVAL) {
    lastBLENotify = now;
    ble.updateBatteryLevel(power.batteryPercent);
    ble.updateChargeState(power.chargeState);
  }

  // ══════════════════════════════════════════════════
  // 6. FIREBASE SENK (periyodik – her 60 sn)
  //    BLE durdur → WiFi aç → sync → WiFi kapat → BLE aç
  // ══════════════════════════════════════════════════
  if (now - lastFirebaseSync >= FIREBASE_SYNC_INTERVAL) {
    lastFirebaseSync = now;
    DEBUG_PRINTLN("[SİSTEM] Firebase senkronizasyonu başlatılıyor...");
    
    // Firebase'e bağlan, durumu senkronize et ve WiFi'yi kapat
    firebase.syncAndDisconnect(power.batteryPercent, power.batteryVoltage, power.chargeState, alarmActive, false);
  }

  // ══════════════════════════════════════════════════
  // 7. GÜÇ TASARRUFU (Deep Sleep iptal edildi)
  // ══════════════════════════════════════════════════
  // Bilekliğin alarm sinyallerini (NRF24) sürekli dinleyebilmesi için 
  // boşta bekleme durumunda Deep Sleep'e girmesi iptal edilmiştir.
  // Sadece kritik pil seviyesinde (batarya koruması için) uykuya geçilir.

  // Kısa bekleme (CPU yükünü azalt)
  delay(10);
}

/* ─────────────────────────────────────────────────────────
   ALARM FONKSİYONLARI
   ───────────────────────────────────────────────────────── */

// İlaç kutusundan NRF24 mesajı geldiğinde çağrılır
void onMedicineAlertReceived(const char *msg) {
  DEBUG_PRINTLN("[ALARM] 💊 İlaç kutusu sinyali alındı!");
  if (!alarmActive) {
    triggerAlarm(ALARM_TYPE_MEDICINE);
  }
}

// App'ten BLE üzerinden alarm komutu geldiğinde çağrılır
void onBLEAlarmCommand(bool activate) {
  if (activate && !alarmActive) {
    triggerAlarm(ALARM_TYPE_APP_TRIGGER);
  } else if (!activate && alarmActive) {
    stopAlarm();
  }
}

// Alarmı başlat
void triggerAlarm(uint8_t type) {
  alarmActive = true;
  alarmType = type;
  alarmPatternIndex = 0;
  alarmRepeatCount = 0;
  inAlarmPause = false;
  vibrateState = true;
  alarmStartTime = millis();
  lastVibrateToggle = millis();

  // Motorları aç
  setVibration(true);

  // Durum LED'i yak
  digitalWrite(STATUS_LED_PIN, HIGH);

  // BLE'ye bildir
  ble.updateAlarmState(true);

  DEBUG_PRINTF("[ALARM] ⚡ Alarm başlatıldı! Tip: %d\n", type);
}

// Alarmı durdur
void stopAlarm() {
  alarmActive = false;
  alarmType = 0;

  // Motorları kapat
  setVibration(false);

  // LED kapat
  digitalWrite(STATUS_LED_PIN, LOW);

  // BLE'ye bildir
  ble.updateAlarmState(false);

  DEBUG_PRINTLN("[ALARM] ✅ Alarm durduruldu.");
}

// Alarm titreşim döngüsü (non-blocking)
void handleAlarmVibration(unsigned long now) {
  if (inAlarmPause) {
    // Döngüler arası bekleme
    if (now - lastVibrateToggle >= ALARM_REPEAT_DELAY_MS) {
      inAlarmPause = false;
      alarmPatternIndex = 0;
      vibrateState = true;
      lastVibrateToggle = now;
      setVibration(true);
    }
    return;
  }

  uint16_t interval = vibrateState ? ALARM_VIBRATE_ON_MS : ALARM_VIBRATE_OFF_MS;

  if (now - lastVibrateToggle >= interval) {
    lastVibrateToggle = now;

    if (vibrateState) {
      // Titreşim sönüyor
      vibrateState = false;
      setVibration(false);
      alarmPatternIndex++;
    } else {
      // Desen sayısını kontrol et
      if (alarmPatternIndex >= ALARM_PATTERN_COUNT) {
        // Bir döngü tamamlandı → bekleme süresine geç
        alarmRepeatCount++;
        inAlarmPause = true;
        lastVibrateToggle = now;
        DEBUG_PRINTF("[ALARM] Döngü #%d tamamlandı.\n", alarmRepeatCount);
      } else {
        // Sonraki titreşim
        vibrateState = true;
        setVibration(true);
      }
    }
  }
}

// 2 motoru birlikte aç/kapa
void setVibration(bool on) { digitalWrite(VIBRO_MOTOR_PIN, on ? HIGH : LOW); }

/* ─────────────────────────────────────────────────────────
   BUTON FONKSİYONLARI
   ───────────────────────────────────────────────────────── */

void handleButton(unsigned long now) {
  // Harici buton veya BOOT butonu
  bool isPressed =
      (digitalRead(BUTTON_PIN) == LOW) || (digitalRead(BOOT_BUTTON_PIN) == LOW);

  if (isPressed) {
    delay(DEBOUNCE_MS);
    // Tekrar kontrol (debounce)
    isPressed = (digitalRead(BUTTON_PIN) == LOW) ||
                (digitalRead(BOOT_BUTTON_PIN) == LOW);

    if (isPressed && !buttonPressed) {
      buttonPressed = true;
      lastActivityTime = now;

      DEBUG_PRINTLN("[BUTON] 👆 Basıldı!");

      if (alarmActive) {
        // ── Alarm aktifken: İlaç alındı onayı ──
        DEBUG_PRINTLN("[BUTON] 💊 İlaç alındı onayı verildi!");

        // 1. Alarmı durdur
        stopAlarm();

        // 2. NRF24 üzerinden ilaç kutusuna onay gönder
        nrf.sendMedicineConfirm();

        // 3. BLE üzerinden app'e bildir
        ble.notifyMedicineTaken();

        // 4. Onay titreşimi (2 kısa bip)
        confirmFeedback();

        // 5. Firebase'e doğrudan bildir
        DEBUG_PRINTLN("[FIREBASE] İlaç alındı onayı buluta gönderiliyor...");
        if (firebase.confirmMedicineTaken()) {
          DEBUG_PRINTLN("[FIREBASE] İlaç alındı onayı başarıyla gönderildi.");
        }
        firebase.disconnectWiFi();

      } else {
        // ── Alarm yokken: Durum göster (kısa LED blink) ──
        statusBlink();
      }
    }
  } else {
    buttonPressed = false;
  }
}

/* ─────────────────────────────────────────────────────────
   GERİ BİLDİRİM FONKSİYONLARI
   ───────────────────────────────────────────────────────── */

// Başlangıç testi: sadece LED (titreşim yalnızca ilaç alarmında!)
void startupFeedback() {
  DEBUG_PRINTLN("[TEST] Donanım testi...");
  for (int i = 0; i < 2; i++) {
    digitalWrite(STATUS_LED_PIN, HIGH);
    delay(120);
    digitalWrite(STATUS_LED_PIN, LOW);
    delay(120);
  }
  DEBUG_PRINTLN("[TEST] ✅ Tamamlandı.");
}

// İlaç onay geri bildirimi: 2 hızlı kısa titreşim
void confirmFeedback() {
  for (int i = 0; i < 2; i++) {
    setVibration(true);
    delay(80);
    setVibration(false);
    delay(80);
  }
}

// Düşük pil uyarısı: sadece LED (titreşim yok)
void lowBatteryBuzz() {
  digitalWrite(STATUS_LED_PIN, HIGH);
  delay(100);
  digitalWrite(STATUS_LED_PIN, LOW);
}

// Kritik pil uyarısı: 3 hızlı titreşim + LED
void criticalBatteryWarning() {
  for (int i = 0; i < 3; i++) {
    setVibration(true);
    digitalWrite(STATUS_LED_PIN, HIGH);
    delay(60);
    setVibration(false);
    digitalWrite(STATUS_LED_PIN, LOW);
    delay(60);
  }
}

// Durum göster: Kısa LED blink
void statusBlink() {
  digitalWrite(STATUS_LED_PIN, HIGH);
  delay(200);
  digitalWrite(STATUS_LED_PIN, LOW);
}

// Tüm çıkışları kapat
void stopAllOutputs() {
  digitalWrite(VIBRO_MOTOR_PIN, LOW);
  digitalWrite(STATUS_LED_PIN, LOW);
}

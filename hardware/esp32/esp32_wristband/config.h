/*
 * =========================================================
 *  CareSync – ESP32-S3 Bileklik Konfigürasyon Dosyası
 *  
 *  Donanım Özellikleri:
 *    - ESP32-S3 (BLE 5.0 destekli)
 *    - 550mAh 3.7V Li-Ion Pil (13400Q3)
 *    - TP4056 Şarj Modülü (USB-C)
 *    - 1x Titreşim Motoru
 *    - ESP-NOW (ESP32 dahili radyo ile ilaç kutusu haberleşmesi)
 *    - 1x Push Button (ilaç onay)
 *    - 1x Durum LED'i
 * =========================================================
 */

#ifndef CONFIG_H
#define CONFIG_H

/* ─── Cihaz Bilgileri ────────────────────────────────────── */
#define DEVICE_NAME           "CareSync-Band"
#define FIRMWARE_VERSION      "2.2.0"
#define DEVICE_ID             "esp32_wristband_01"

/* ─── ESP-NOW Ayarları ────────────────────────────────── */
// WiFi kanalı (ilaç kutusu ile aynı olmalı!)
// İlaç kutusu WiFi'a bağlandığında otomatik kanal alır,
// bilekliği aynı kanala ayarla. Varsayılan: 1
#define ESPNOW_CHANNEL        4

/* ─── Titreşim Motoru ────────────────────────────────────── */
// 1 adet düğme titreşim motoru (2N2222A transistör üzerinden)
#define VIBRO_MOTOR_PIN       4     // Titreşim motoru (GPIO 4 → 330Ω → 2N2222A Base)

/* ─── Buton ──────────────────────────────────────────────── */
#define BUTTON_PIN            6     // İlaç alındı onay butonu (INPUT_PULLUP)
#define BOOT_BUTTON_PIN       0     // Dahili BOOT butonu (yedek)

/* ─── Durum LED'i ────────────────────────────────────────── */
#define STATUS_LED_PIN        38    // Küçük durum LED'i (şarj/bağlantı)

/* ─── Pil Yönetimi (ADC) ────────────────────────────────── */
// Voltaj bölücü: Pil(+) → 100kΩ → ADC_PIN → 100kΩ → GND
// Max pil voltajı 4.2V → ADC'de max 2.1V okunur
#define BATTERY_ADC_PIN       1     // ADC1 kanalı
#define BATTERY_DIVIDER_RATIO 2.0   // Voltaj bölücü oranı (100k/100k)

// Pil voltaj seviyeleri (Li-Po 3.7V nominal)
#define BATTERY_FULL_VOLTAGE    4.20  // %100
#define BATTERY_NOMINAL_VOLTAGE 3.70  // ~%50
#define BATTERY_LOW_VOLTAGE     3.30  // ~%10 - düşük pil uyarısı
#define BATTERY_CRITICAL_VOLTAGE 3.10 // ~%2 - deep sleep'e geç
#define BATTERY_EMPTY_VOLTAGE   3.00  // %0 - kapanma eşiği

// Pil kapasitesi
#define BATTERY_CAPACITY_MAH    550   // 550mAh Li-Ion (13400Q3)

/* ─── TP4056 Şarj Modülü ────────────────────────────────── */
// TP4056'nın durum pinleri (aktif LOW)
#define CHARGE_STATUS_PIN     7     // CHRG pini: LOW = şarj oluyor
#define CHARGE_DONE_PIN       8     // STDBY pini: LOW = şarj tamamlandı

// Şarj durumu kodları
#define CHARGE_STATE_NONE       0   // Şarj kablosu takılı değil
#define CHARGE_STATE_CHARGING   1   // Şarj oluyor
#define CHARGE_STATE_COMPLETE   2   // Şarj tamamlandı

/* ─── ESP-NOW (NRF24 kaldırıldı) ────────────────────────── */
// Bileklikte NRF24L01 modülü yok.
// Haberleşme ESP32 dahili radyo (ESP-NOW) ile yapılır.
// Eski NRF24 SPI pinleri (11,13,12,10,9) artık boşta.

/* ─── BLE Ayarları ───────────────────────────────────────── */
// BLE Servis UUID'leri
#define BLE_SERVICE_UUID            "12345678-1234-5678-1234-56789abcdef0"
#define BLE_CHAR_BATTERY_UUID       "12345678-1234-5678-1234-56789abcdef1"
#define BLE_CHAR_CHARGE_UUID        "12345678-1234-5678-1234-56789abcdef2"
#define BLE_CHAR_ALARM_UUID         "12345678-1234-5678-1234-56789abcdef3"
#define BLE_CHAR_MEDICINE_UUID      "12345678-1234-5678-1234-56789abcdef4"
#define BLE_CHAR_DEVICE_INFO_UUID   "12345678-1234-5678-1234-56789abcdef5"

// BLE Advertising aralığı (ms) – 550mAh pil için optimize
#define BLE_ADV_INTERVAL_MIN  320   // 200ms (320 * 0.625ms)
#define BLE_ADV_INTERVAL_MAX  480   // 300ms (480 * 0.625ms)

/* ─── Zamanlama Sabitleri ────────────────────────────────── */
#define BATTERY_CHECK_INTERVAL    30000   // 30 saniyede bir pil kontrolü
#define BLE_NOTIFY_INTERVAL       5000    // 5 saniyede bir BLE güncelleme

#define ALARM_VIBRATE_ON_MS       400     // Titreşim süresi (ms)
#define ALARM_VIBRATE_OFF_MS      300     // Titreşim arası bekleme (ms)
#define ALARM_PATTERN_COUNT       5       // Bir alarm döngüsündeki titreşim sayısı
#define ALARM_REPEAT_DELAY_MS     2000    // Alarm döngüleri arası bekleme (ms)
#define DEBOUNCE_MS               50      // Buton debounce süresi

/* ─── Deep Sleep Ayarları ────────────────────────────────── */
// 550mAh (13400Q3) ile daha rahat güç yönetimi
#define DEEP_SLEEP_IDLE_TIMEOUT   600000  // 10 dakika işlem yoksa deep sleep
#define DEEP_SLEEP_WAKEUP_PIN     BUTTON_PIN  // Buton ile uyan
#define LIGHT_SLEEP_INTERVAL      2000    // Light sleep'te 2 sn'de bir kontrol
#define DISABLE_DEEP_SLEEP_ON_USB true    // USB güçte deep sleep'i devre dışı bırak

/* ─── Alarm Tipleri ──────────────────────────────────────── */
#define ALARM_TYPE_MEDICINE     1   // İlaç saati alarmı
#define ALARM_TYPE_LOW_BATTERY  2   // Düşük pil uyarısı
#define ALARM_TYPE_DISCONNECT   3   // Bağlantı kopma uyarısı
#define ALARM_TYPE_APP_TRIGGER  4   // App'ten tetiklenen alarm

/* ─── Debug ──────────────────────────────────────────────── */
#define SERIAL_BAUD_RATE      115200
#define DEBUG_ENABLED         true

#if DEBUG_ENABLED
  #define DEBUG_PRINT(x)      Serial.print(x)
  #define DEBUG_PRINTLN(x)    Serial.println(x)
  #define DEBUG_PRINTF(...)   Serial.printf(__VA_ARGS__)
#else
  #define DEBUG_PRINT(x)
  #define DEBUG_PRINTLN(x)
  #define DEBUG_PRINTF(...)
#endif

#endif // CONFIG_H

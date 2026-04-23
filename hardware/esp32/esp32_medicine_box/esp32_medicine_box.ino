/*
 * =========================================================
 *  CareSync – ESP32-S3 İlaç Kutusu (Ana Cihaz)
 *  Kart: ESP32-S3 2022 v1.3
 *
 *  Donanım Bağlantıları:
 *    LED      → GPIO 4
 *    Buzzer   → GPIO 46
 *    Button   → GPIO 36
 *
 *  NRF24L01:
 *    MOSI     → GPIO 5
 *    MISO     → GPIO 6
 *    SCK      → GPIO 7
 *    CE       → GPIO 15
 *    CSN      → GPIO 16
 *    VCC      → 3.3V
 *    GND      → GND
 * =========================================================
 */

#include <Firebase_ESP_Client.h>
#include <addons/RTDBHelper.h>
#include <addons/TokenHelper.h>
#include <ArduinoJson.h>  // JSON parse işlemleri için gerekli
#include <RF24.h>
#include <SPI.h>
#include <WiFi.h>
#include <time.h>  // NTP Saat işlemleri için

/* ─── ESP32-S3 Uyumluluğu ──────────────────────────────── */
// ESP32-S3 kartlarında VSPI tanımlı değildir, FSPI kullanılır
#ifndef VSPI
#define VSPI FSPI
#endif

/* ─── WiFi Ayarları ─────────────────────────────────────── */
#define WIFI_SSID "Harun59"
#define WIFI_PASSWORD "Harun5959"

/* ─── Firebase Ayarları ─────────────────────────────────── */
#define API_KEY "AIzaSyDHII3X9MFkX5_HF6W5NtyosNyHFef9uDs"
#define PROJECT_ID "saglikbileklik-356ed"
#define USER_EMAIL "test@test.com"
#define USER_PASSWORD "test123"

/* ─── Pin Tanımlamaları ──────────────────────────────────── */
#define LED_PIN 4      // Uyarı LED'i
#define BUZZER_PIN 46  // Buzzer
#define BUTTON_PIN 36  // Buton (ilaç alındı onayı)

// NRF24L01 SPI Pinleri
#define NRF_MOSI 5
#define NRF_MISO 6
#define NRF_SCK 7
#define NRF_CE 15
#define NRF_CSN 16

/* ─── NRF24L01 Kurulumu ──────────────────────────────────── */
// ESP32-S3 üzerinde SPI kurulumu (FSPI/VSPI)
SPIClass vspi(VSPI);
RF24 radio(NRF_CE, NRF_CSN);  // CE, CSN

// NRF24 haberleşme kanalı (her iki cihazda aynı olmalı)
const byte address[6] = "ILACK";

/* ─── Firebase Nesneleri ─────────────────────────────────── */
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

/* ─── Zamanlama ──────────────────────────────────────────── */
unsigned long lastFirebaseCheck = 0;
const unsigned long FIREBASE_INTERVAL = 15000;  // 15 saniyede bir kontrol

/* ─── Durum Bayrakları ───────────────────────────────────── */
String deviceId = "esp32_medicine_box_01";
bool alarmActive = false;
bool buttonPressed = false;
String lastTriggeredAlarmTime =
  "";  // Aynı dakika içinde defalarca ötmemesi için

// Sürekli alarm (non-blocking) için değişkenler
unsigned long lastBeepTime = 0;
bool beepState = false;

/* ─────────────────────────────────────────────────────────
   SETUP
   ───────────────────────────────────────────────────────── */
void setup() {
  Serial.begin(115200);
  delay(200);

  // Pin modları
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);  // Buton: LOW = basılı

  digitalWrite(LED_PIN, LOW);
  digitalWrite(BUZZER_PIN, LOW);

  Serial.println("\n=== CareSync ESP32 Başlıyor ===");

  // ── SPI (VSPI) Başlat ──
  vspi.begin(NRF_SCK, NRF_MISO, NRF_MOSI, NRF_CSN);
  delay(50);

  // ── NRF24L01 Başlat ──
  if (!radio.begin(&vspi)) {
    Serial.println("[HATA] NRF24L01 başlatılamadı! Bağlantıyı kontrol edin.");
  } else {
    radio.openWritingPipe(address);
    radio.setPALevel(RF24_PA_HIGH);
    radio.setDataRate(RF24_250KBPS);
    radio.stopListening();  // Bu cihaz verici (TX)
    Serial.println("[OK] NRF24L01 hazır.");
  }

  // ── WiFi Bağlan ──
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi bağlanıyor");
  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 30) {
    Serial.print(".");
    delay(500);
    retries++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi bağlandı: " + WiFi.localIP().toString());
  } else {
    Serial.println(
      "\n[UYARI] WiFi bağlanamadı, çevrimdışı modda devam ediliyor.");
  }

  // ── NTP (Saat) Senkronizasyonu ──
  // Türkiye saati: UTC+3
  configTzTime("TRT-3", "pool.ntp.org", "time.nist.gov");
  Serial.print("[NTP] Saat bekleniyor");
  time_t now = time(nullptr);
  int ntpRetries = 0;
  while (now < 24 * 3600 && ntpRetries < 20) {
    Serial.print(".");
    delay(500);
    now = time(nullptr);
    ntpRetries++;
  }
  if (now > 24 * 3600) {
    struct tm timeinfo;
    getLocalTime(&timeinfo);
    Serial.printf("\n[NTP] Saat güncellendi: %02d:%02d\n", timeinfo.tm_hour,
                  timeinfo.tm_min);
  } else {
    Serial.println("\n[NTP] Saat alınamadı! (Geçici çevrimdışı saat)");
  }

  // ── Firebase Başlat ──
  config.api_key = API_KEY;
  auth.user.email = USER_EMAIL;
  auth.user.password = USER_PASSWORD;
  config.token_status_callback = tokenStatusCallback;

  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);

  // Başlangıç LED & Buzzer testi
  startupSequence();

  // Firebase cihaz durumunu güncelle
  updateDeviceStatus("online");

  Serial.println("=== Sistem Hazır ===");
}

/* ─────────────────────────────────────────────────────────
   LOOP
   ───────────────────────────────────────────────────────── */
void loop() {
  // ── NTP Yedek Kontrolü ve Bilgi Yazdırma ──
  static unsigned long lastTimePrint = 0;
  if (millis() - lastTimePrint > 60000) {
    lastTimePrint = millis();
    time_t now = time(nullptr);
    if (now < 24 * 3600) {
      Serial.println("[NTP] Saat geçersiz, tekrar senkronize ediliyor...");
      configTzTime("TRT-3", "pool.ntp.org", "time.nist.gov");
    } else {
      Serial.println("[ZAMAN] ESP32 Güncel Saat: " + getCurrentTimeStr() + " (Gün: " + getCurrentDayStr() + ")");
    }
  }

  // ── Alarm Aktifse Sürekli Ötme (Non-blocking) ──
  if (alarmActive) {
    unsigned long currentMillis = millis();
    // 500ms aralıklarla bip sesi (500ms açık, 500ms kapalı)
    if (currentMillis - lastBeepTime >= 500) {
      lastBeepTime = currentMillis;
      beepState = !beepState;
      digitalWrite(LED_PIN, beepState ? HIGH : LOW);
      digitalWrite(BUZZER_PIN, beepState ? HIGH : LOW);
    }
  }

  // ── Buton Kontrolü ──
  if (digitalRead(BUTTON_PIN) == LOW) {
    delay(50);  // Debounce
    if (digitalRead(BUTTON_PIN) == LOW) {
      if (!buttonPressed) {
        buttonPressed = true;
        Serial.println("[BUTON] İlaç alındı onayı!");

        if (alarmActive) {
          stopAlarm();
          confirmMedicineTaken();
        }
      }
    }
  } else {
    buttonPressed = false;
  }

  // ── Firebase Periyodik Kontrol ──
  if (Firebase.ready() && (millis() - lastFirebaseCheck > FIREBASE_INTERVAL || lastFirebaseCheck == 0)) {
    lastFirebaseCheck = millis();
    checkFirebaseAlarm();
  }
}

/* ─────────────────────────────────────────────────────────
   FONKSİYONLAR
   ───────────────────────────────────────────────────────── */

// Güncel saati "HH:MM" formatında döndürür
String getCurrentTimeStr() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    return "";
  }
  char timeStringBuff[10];
  strftime(timeStringBuff, sizeof(timeStringBuff), "%H:%M", &timeinfo);
  return String(timeStringBuff);
}

// Güncel günü React Native formatında döndürür (0=Pzt, 6=Paz)
String getCurrentDayStr() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    return "";
  }
  // C++ tm_wday: 0=Pazar, 1=Pazartesi... 6=Cumartesi
  // React Native format: 0=Pazartesi... 6=Pazar
  int rnDay = (timeinfo.tm_wday == 0) ? 6 : (timeinfo.tm_wday - 1);
  return String(rnDay);
}

// Firebase'den alarm gelip gelmediğini kontrol et
void checkFirebaseAlarm() {
  String documentPath = "devices/" + deviceId;

  if (Firebase.Firestore.getDocument(&fbdo, PROJECT_ID, "",
                                     documentPath.c_str(), "")) {
    Serial.println("[Firebase] Belge alındı. JSON ayrıştırılıyor...");

    // Gelen JSON verisini parse et
    DynamicJsonDocument doc(4096);
    DeserializationError error = deserializeJson(doc, fbdo.payload());

    if (error) {
      Serial.print("[JSON Hata] Ayrıştırma başarısız: ");
      Serial.println(error.c_str());
      return;
    }

    // YÖNTEM B: 'triggerAlert' kontrolü (Mobil uygulama anlık tetikler)
    bool triggerAlert = doc["fields"]["triggerAlert"]["booleanValue"] | false;
    
    // UZAKTAN DURDURMA KONTROLÜ
    bool stopAlert = doc["fields"]["stopAlert"]["booleanValue"] | false;

    // YÖNTEM A: 'scheduleJSON' kontrolü (Bağımsız Cihaz)
    String scheduleJSONStr = doc["fields"]["scheduleJSON"]["stringValue"] | "";
    String currentTime = getCurrentTimeStr();
    String currentDay = getCurrentDayStr();

    if (stopAlert) {
      Serial.println("[ALARM] Firebase'den 'stopAlert=true' (Durdur) komutu geldi!");
      if (alarmActive) {
        stopAlarm();
      }
      clearStopAlert(); // İşlem bittikten sonra Firebase'de false yap
    }

    if (triggerAlert) {
      Serial.println("[ALARM] Firebase'den 'triggerAlert=true' komutu geldi!");
      if (!alarmActive) {
        triggerAlarm();
        // Alarmın sonsuz döngüde çalmasını engellemek için Firebase'de false'a
        // çekilebilir
        clearTriggerAlert();
      }
    } else if (scheduleJSONStr != "" && currentTime != "" && currentDay != "") {
      Serial.println("\n[DEBUG] ---------------------------------------");
      Serial.println("[DEBUG] Firebase'den Gelen Ham JSON:");
      Serial.println(scheduleJSONStr);
      Serial.println("[DEBUG] ---------------------------------------");
      
      // Haftalık programı parse et
      DynamicJsonDocument schedDoc(2048);
      DeserializationError schedError = deserializeJson(schedDoc, scheduleJSONStr);

      if (!schedError) {
        JsonObject root = schedDoc.as<JsonObject>();
        // Bugünün saatlerini kontrol et
        JsonArray todayAlarms = root[currentDay.c_str()];
        bool shouldAlarm = false;
        
        Serial.println("[DEBUG] İncelenen Gün: " + currentDay + " | Mevcut Saat: " + currentTime);
        Serial.print("[DEBUG] Bu Gün İçin Ayarlı Saatler: ");
        
        if (todayAlarms.isNull() || todayAlarms.size() == 0) {
           Serial.println("(Hiç alarm yok - veya JSON'da gün key'i bulunamadı)");
        } else {
           for (JsonVariant value : todayAlarms) {
             String alarmTime = value.as<String>();
             alarmTime.trim(); // Boşlukları temizle
             Serial.print(alarmTime + " ");
             if (alarmTime == currentTime) {
               shouldAlarm = true;
             }
           }
           Serial.println("");
        }

        if (shouldAlarm) {
          // Eğer saat eşleşirse ve bu dakika içinde daha önce çalmadıysa
          if (lastTriggeredAlarmTime != currentTime && !alarmActive) {
            Serial.println("[ALARM] Programlanan saat geldi: " + currentTime);
            lastTriggeredAlarmTime = currentTime;
            triggerAlarm();
          } else if (lastTriggeredAlarmTime == currentTime) {
            Serial.println("[DEBUG] Alarm bu dakika içinde zaten tetiklendi.");
          }
        } else {
          // Eğer şu anki dakika alarm dakikası değilse, önceki tetiklenme bilgisini sıfırla ki yarın tekrar çalabilelim
          if (lastTriggeredAlarmTime != "") {
             lastTriggeredAlarmTime = "";
          }
        }
      } else {
        Serial.println("[JSON Hata] scheduleJSON parse edilemedi.");
      }
    }
  } else {
    Serial.println("[Firebase] Hata: " + fbdo.errorReason());
  }
}

// Alarm çaldıktan sonra 'triggerAlert' alanını temizle
void clearTriggerAlert() {
  if (Firebase.ready()) {
    FirebaseJson content;
    content.set("fields/triggerAlert/booleanValue", false);

    String documentPath = "devices/" + deviceId;
    if (Firebase.Firestore.patchDocument(&fbdo, PROJECT_ID, "",
                                         documentPath.c_str(), content.raw(),
                                         "triggerAlert")) {
      Serial.println("[Firebase] triggerAlert false yapıldı.");
    }
  }
}

// Alarm durdurulduktan sonra 'stopAlert' alanını temizle
void clearStopAlert() {
  if (Firebase.ready()) {
    FirebaseJson content;
    content.set("fields/stopAlert/booleanValue", false);

    String documentPath = "devices/" + deviceId;
    if (Firebase.Firestore.patchDocument(&fbdo, PROJECT_ID, "",
                                         documentPath.c_str(), content.raw(),
                                         "stopAlert")) {
      Serial.println("[Firebase] stopAlert false yapıldı.");
    }
  }
}

// Alarm başlat: Sadece bayrakları kurar, asıl ötme işlemi loop() içinde yapılır
void triggerAlarm() {
  alarmActive = true;
  beepState = true;
  lastBeepTime = millis();
  digitalWrite(LED_PIN, HIGH);
  digitalWrite(BUZZER_PIN, HIGH);
  Serial.println("[ALARM] Alarm başlatıldı! (Butona basılana kadar ötecek)");

  // NRF24 ile bilekliğe sinyal gönder
  sendNRFSignal();
  
  // Mobil uygulamaya "Alarm Çaldı" bilgisini gönder
  sendAlertToApp();
}

// Uygulamaya otonom alarmın başladığını haber ver (AlertOverlay çıkması için)
void sendAlertToApp() {
  if (Firebase.ready()) {
    FirebaseJson content;
    // Uygulama bu alanın güncellendiğini görünce lokal bildirim/AlertOverlay çıkartabilir
    content.set("fields/lastAutonomousAlarm/stringValue", getCurrentTimeStr());
    
    String documentPath = "devices/" + deviceId;
    if (Firebase.Firestore.patchDocument(&fbdo, PROJECT_ID, "",
                                         documentPath.c_str(), content.raw(),
                                         "lastAutonomousAlarm")) {
      Serial.println("[Firebase] Uygulamaya bildirim gönderildi (lastAutonomousAlarm güncellendi).");
    }
  }
}

// Alarm durdur
void stopAlarm() {
  alarmActive = false;
  digitalWrite(LED_PIN, LOW);
  digitalWrite(BUZZER_PIN, LOW);
  Serial.println("[ALARM] Alarm durduruldu.");
}

// NRF24L01 üzerinden bilekliğe "İlaç zamanı!" sinyali gönder
void sendNRFSignal() {
  const char msg[] = "ILAC";
  bool ok = radio.write(&msg, sizeof(msg));
  if (ok) {
    Serial.println("[NRF24] Bilekliğe sinyal gönderildi.");
  } else {
    Serial.println("[NRF24] Sinyal gönderilemedi!");
  }
}

// Firebase'e ilaç alındı bilgisini kaydet
void confirmMedicineTaken() {
  if (Firebase.ready()) {
    FirebaseJson content;
    content.set("fields/lastTaken/stringValue", getTimestamp());
    content.set("fields/status/stringValue", "taken");

    String documentPath = "devices/" + deviceId;
    if (Firebase.Firestore.patchDocument(&fbdo, PROJECT_ID, "",
                                         documentPath.c_str(), content.raw(),
                                         "lastTaken,status")) {
      Serial.println("[Firebase] İlaç alındı kaydedildi.");
    } else {
      Serial.println("[Firebase] Kayıt hatası: " + fbdo.errorReason());
    }
  }
}

// Firebase'e cihaz durumunu bildir
void updateDeviceStatus(String status) {
  if (!Firebase.ready())
    return;

  FirebaseJson content;
  content.set("fields/status/stringValue", status);
  content.set("fields/type/stringValue", "box");
  content.set("fields/batteryLevel/integerValue", 100);
  content.set("fields/signalStrength/stringValue", "strong");
  content.set("fields/radioModule/stringValue", "NRF24L01");
  content.set(
    "fields/pins/stringValue",
    "LED:4 | BZR:46 | BTN:36 | CE:15 | CSN:16 | SCK:7 | MOSI:5 | MISO:6");

  String documentPath = "devices/" + deviceId;
  if (Firebase.Firestore.patchDocument(
        &fbdo, PROJECT_ID, "", documentPath.c_str(), content.raw(),
        "status,type,batteryLevel,signalStrength,radioModule,pins")) {
    Serial.println("[Firebase] Cihaz durumu güncellendi: " + status);
  } else {
    Serial.println("[Firebase] Güncelleme hatası: " + fbdo.errorReason());
  }
}

// Başlangıç testi: LED + Buzzer kısa bip
void startupSequence() {
  Serial.println("[TEST] Donanım testi...");
  for (int i = 0; i < 2; i++) {
    digitalWrite(LED_PIN, HIGH);
    digitalWrite(BUZZER_PIN, HIGH);
    delay(150);
    digitalWrite(LED_PIN, LOW);
    digitalWrite(BUZZER_PIN, LOW);
    delay(150);
  }
  Serial.println("[TEST] Tamamlandı.");
}

// Basit timestamp (Firebase için)
String getTimestamp() {
  time_t now = time(nullptr);
  return String(now);
}

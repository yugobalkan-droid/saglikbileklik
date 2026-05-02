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
 *  NRF24L01 KALDIRILDI → ESP-NOW kullanılıyor:
 *    ESP-NOW             → Dahili (ESP32-S3 WiFi radyo)
 *    VCC                 → (gerekmiyor)
 *    GND                 → (gerekmiyor)
 * =========================================================
 */

#include <ArduinoJson.h> // JSON parse işlemleri için gerekli
#include <Firebase_ESP_Client.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <addons/RTDBHelper.h>
#include <addons/TokenHelper.h>
#include <time.h> // NTP Saat işlemleri için

/* ─── ESP32-S3 Uyumluluğu ──────────────────────────────── */
// NRF24 kaldırıldı – ESP-NOW kullanılıyor

/* ─── WiFi Ayarları ─────────────────────────────────────── */
#define WIFI_SSID "Harun59"
#define WIFI_PASSWORD "Harun5959"

/* ─── Firebase Ayarları ─────────────────────────────────── */
#define API_KEY "AIzaSyDHII3X9MFkX5_HF6W5NtyosNyHFef9uDs"
#define PROJECT_ID "saglikbileklik-356ed"
#define USER_EMAIL "test@test.com"
#define USER_PASSWORD "test123"

/* ─── Pin Tanımlamaları ──────────────────────────────────── */
#define LED_PIN 4     // Uyarı LED'i
#define BUZZER_PIN 46 // Buzzer
#define BUTTON_PIN 36 // Buton (ilaç alındı onayı)

// Eski NRF24 pinleri artık kullanılmıyor (boş)
// #define NRF_MOSI 5
// #define NRF_MISO 6
// #define NRF_SCK 7
// #define NRF_CE 15
// #define NRF_CSN 16

/* ─── ESP-NOW Mesaj Yapısı ────────────────────────────── */
// Bileklik ile aynı yapı (her iki tarafta eş olmalı!)
typedef struct espnow_message_t {
  char deviceId[20];   // Gönderen cihaz kimliği
  char command[10];    // Komut: "ILAC", "ONAY", "PING", "PONG"
  uint32_t timestamp;  // millis() zaman damgası
} espnow_message_t;

// Broadcast MAC adresi
uint8_t broadcastAddress[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
bool espnowReady = false;

/* ─── Durum Bayrakları ───────────────────────────────────── */
String deviceId = "esp32_medicine_box_01";
bool alarmActive = false;
bool buttonPressed = false;
String lastTriggeredAlarmTime = "";

// Sürekli alarm (non-blocking) için değişkenler
unsigned long lastBeepTime = 0;
unsigned long alarmStartTime = 0;
bool beepState = false;

// Ses ayarları
int melodyType = 0; // 0: Standart, 1: Siren, 2: Hızlı, 3: Özel
int customFreq = 1000;
int customSpeed = 500;
bool testSoundActive = false;
unsigned long testSoundStartTime = 0;

/* ─── Fonksiyon Bildirimleri ─────────────────────────────── */
void stopAlarm();
void confirmMedicineTaken();

/* ─── ESP-NOW Callback'leri ────────────────────────────── */
// Bileklikten mesaj geldiğinde
#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 0, 0)
void onESPNowDataRecv(const esp_now_recv_info_t *info, const uint8_t *data, int dataLen) {
#else
void onESPNowDataRecv(const uint8_t *mac, const uint8_t *data, int dataLen) {
#endif
  if (dataLen != sizeof(espnow_message_t)) return;
  
  espnow_message_t msg;
  memcpy(&msg, data, sizeof(msg));
  
  Serial.printf("[ESP-NOW] 📨 Mesaj alındı: cmd=%s, from=%s\n", msg.command, msg.deviceId);
  
  if (strcmp(msg.command, "ONAY") == 0) {
    Serial.println("[ESP-NOW] ✅ Bileklikten ilaç onayı alındı!");
    if (alarmActive) {
      stopAlarm();
      confirmMedicineTaken();
    }
  }
}

// Mesaj gönderim durumu
#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 0, 0)
void onESPNowDataSent(const wifi_tx_info_t *info, esp_now_send_status_t status) {
#else
void onESPNowDataSent(const uint8_t *mac_addr, esp_now_send_status_t status) {
#endif
  Serial.printf("[ESP-NOW] Gönderim: %s\n", 
                status == ESP_NOW_SEND_SUCCESS ? "✅ Başarılı" : "❌ Başarısız");
}

/* ─── Firebase Nesneleri ─────────────────────────────────── */
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

/* ─── Zamanlama ──────────────────────────────────────────── */
unsigned long lastFirebaseCheck = 0;
const unsigned long FIREBASE_INTERVAL = 15000; // 15 saniyede bir kontrol


/* ─────────────────────────────────────────────────────────
   SETUP
   ───────────────────────────────────────────────────────── */
void setup() {
  Serial.begin(115200);
  delay(200);

  // Pin modları
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP); // Harici Buton
  pinMode(0, INPUT_PULLUP);          // Dahili BOOT Butonu

  digitalWrite(LED_PIN, LOW);
  digitalWrite(BUZZER_PIN, LOW);

  Serial.println("\n=== CareSync ESP32 Başlıyor ===");

  // ── WiFi Bağlan ──
  WiFi.mode(WIFI_AP_STA);  // AP+STA modu: ESP-NOW + WiFi birlikte çalışsın
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi bağlanıyor");
  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 30) {
    Serial.print(".");
    delay(500);
    retries++;
  }
    if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WIFI] ✅ WiFi bağlandı!");
    Serial.println("[WIFI] IP Adresi: " + WiFi.localIP().toString());
    
    // Bilekliğin kanalı bulabilmesi için aynı kanalda görünür bir AP başlat
    WiFi.softAP("CareSync_Box", "12345678", WiFi.channel(), 0); // 0 = görünür AP
    
    Serial.printf("\n======================================================\n");
    Serial.printf("👉 BİLEKLİK İÇİN GEREKLİ KANAL (ESPNOW_CHANNEL): %d\n", WiFi.channel());
    Serial.printf("======================================================\n\n");
  } else {
    Serial.println("\n[WIFI] ❌ WiFi bağlanamadı, çevrimdışı modda devam ediliyor.");
    WiFi.softAP("CareSync_Box", "12345678", 4, 0); // Varsayılan kanal 4, görünür
  }


  // ── ESP-NOW Başlat (WiFi'dan sonra!) ──
  if (esp_now_init() == ESP_OK) {
    esp_now_register_recv_cb(onESPNowDataRecv);
    esp_now_register_send_cb(onESPNowDataSent);
    
    // Broadcast peer ekle
    esp_now_peer_info_t peerInfo = {};
    memcpy(peerInfo.peer_addr, broadcastAddress, 6);
    peerInfo.channel = 0;  // WiFi kanalı ile aynı (otomatik)
    peerInfo.encrypt = false;
    esp_now_add_peer(&peerInfo);
    
    espnowReady = true;
    Serial.println("[ESP-NOW] ✅ ESP-NOW hazır!");
    
    // MAC adresini yazdır
    uint8_t mac[6];
    WiFi.macAddress(mac);
    Serial.printf("[ESP-NOW] 📟 Bu cihazın MAC: %02X:%02X:%02X:%02X:%02X:%02X\n",
                  mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  } else {
    Serial.println("[ESP-NOW] ❌ Başlatılamadı!");
  }

  // ── NTP (Saat) Senkronizasyonu ──
  // Türkiye saati: UTC+3 (3 * 3600 = 10800 saniye ofset)
  configTime(10800, 0, "pool.ntp.org", "time.nist.gov");
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
      configTime(10800, 0, "pool.ntp.org", "time.nist.gov");
    } else {
      Serial.println("[ZAMAN] ESP32 Güncel Saat: " + getCurrentTimeStr() +
                     " (Gün: " + getCurrentDayStr() + ")");
      Serial.println("[WIFI] İlaç Kutusu WiFi Kanalı: " + String(WiFi.channel()) + " (Bilekliğin config.h dosyasında ESPNOW_CHANNEL ayarını bu sayı yapın)");
    }
  }

  // ── Alarm Aktifse Sürekli Ötme (Non-blocking) ──
  if (alarmActive || testSoundActive) {
    unsigned long currentMillis = millis();

    // Test sesi ise 3 saniye sonra kapat
    if (testSoundActive && (currentMillis - testSoundStartTime >= 3000)) {
      testSoundActive = false;
      noTone(BUZZER_PIN);
      digitalWrite(LED_PIN, LOW);
      Serial.println("[TEST] Ses testi bitti.");
    } 
    // Gerçek alarm ise 10 dakika (600,000 ms) zaman aşımı kontrolü
    else if (alarmActive && (currentMillis - alarmStartTime >= 600000)) {
      Serial.println("[ALARM] 10 dakika geçti, butona basılmadı. İlaç kaçırıldı!");
      stopAlarm();
      sendMissedAlertToApp();
    } 
    else {
      // Melodi Çalma Motoru
      int speedMs = 500;
      int freq1 = 1000;
      int freq2 = 0;
      
      if (melodyType == 0) { // Standart Bip
        speedMs = 1000;
        freq1 = 1000;
        freq2 = 0;
      } else if (melodyType == 1) { // Siren
        speedMs = 300;
        freq1 = 800;
        freq2 = 1200;
      } else if (melodyType == 2) { // Hızlı Bip
        speedMs = 150;
        freq1 = 2000;
        freq2 = 0;
      } else if (melodyType == 3) { // Özel
        speedMs = customSpeed;
        freq1 = customFreq;
        freq2 = 0;
      }

      if (currentMillis - lastBeepTime >= speedMs) {
        lastBeepTime = currentMillis;
        beepState = !beepState;
        
        digitalWrite(LED_PIN, beepState ? HIGH : LOW);
        
        if (beepState) {
          tone(BUZZER_PIN, freq1);
          // Gerçek alarm ise ESP-NOW sinyali gönder
          if (alarmActive) sendESPNowSignal();
        } else {
          if (freq2 > 0) {
            tone(BUZZER_PIN, freq2); // Siren için 2. ton
          } else {
            noTone(BUZZER_PIN); // Sessizlik
          }
        }
      }
    }
  }

  // ── Buton Kontrolü (Harici buton veya Dahili BOOT butonu) ──
  bool isPressed = (digitalRead(BUTTON_PIN) == LOW) ||
                   (digitalRead(0) == LOW); // 0 = BOOT Butonu

  if (isPressed) {
    delay(50); // Debounce
    // Tekrar kontrol et
    if ((digitalRead(BUTTON_PIN) == LOW) || (digitalRead(0) == LOW)) {
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
  if (Firebase.ready() && (millis() - lastFirebaseCheck > FIREBASE_INTERVAL ||
                           lastFirebaseCheck == 0)) {
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

    // YÖNTEM C: Ses Testi Kontrolü
    bool testSound = doc["fields"]["testSound"]["booleanValue"] | false;

    // SES AYARLARINI OKU
    if (doc["fields"].containsKey("settings")) {
      JsonObject settingsMap = doc["fields"]["settings"]["mapValue"]["fields"];
      if (settingsMap.containsKey("melodyType")) {
        melodyType = atoi(settingsMap["melodyType"]["integerValue"].as<const char*>());
      }
      if (settingsMap.containsKey("customFreq")) {
        int f = atoi(settingsMap["customFreq"]["integerValue"].as<const char*>());
        if (f > 0) customFreq = f;
      }
      if (settingsMap.containsKey("customSpeed")) {
        int s = atoi(settingsMap["customSpeed"]["integerValue"].as<const char*>());
        if (s > 0) customSpeed = s;
      }
    }

    if (testSound && !testSoundActive) {
      Serial.println("[TEST] Firebase'den 'testSound=true' komutu geldi!");
      testSoundActive = true;
      testSoundStartTime = millis();
      lastBeepTime = millis();
      beepState = true;
      digitalWrite(LED_PIN, HIGH);
      
      FirebaseJson content;
      content.set("fields/testSound/booleanValue", false);
      String documentPath = "devices/" + deviceId;
      Firebase.Firestore.patchDocument(&fbdo, PROJECT_ID, "", documentPath.c_str(), content.raw(), "testSound");
    }

    // YÖNTEM A: 'scheduleJSON' kontrolü (Bağımsız Cihaz)
    String scheduleJSONStr = doc["fields"]["scheduleJSON"]["stringValue"] | "";
    String currentTime = getCurrentTimeStr();
    String currentDay = getCurrentDayStr();

    if (stopAlert) {
      Serial.println(
          "[ALARM] Firebase'den 'stopAlert=true' (Durdur) komutu geldi!");
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
      Serial.printf("[DEBUG] WiFi Kanalı (ESP-NOW Kanalı): %d\n", WiFi.channel());
      Serial.println("[DEBUG] Firebase'den Gelen Ham JSON:");
      Serial.println(scheduleJSONStr);
      Serial.println("[DEBUG] ---------------------------------------");

      // Haftalık programı parse et
      DynamicJsonDocument schedDoc(2048);
      DeserializationError schedError =
          deserializeJson(schedDoc, scheduleJSONStr);

      if (!schedError) {
        JsonObject root = schedDoc.as<JsonObject>();
        // Bugünün saatlerini kontrol et
        JsonArray todayAlarms = root[currentDay.c_str()];
        bool shouldAlarm = false;

        Serial.println("[DEBUG] İncelenen Gün: " + currentDay +
                       " | Mevcut Saat: " + currentTime);
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
          // Eğer şu anki dakika alarm dakikası değilse, önceki tetiklenme
          // bilgisini sıfırla ki yarın tekrar çalabilelim
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
  alarmStartTime = millis();
  digitalWrite(LED_PIN, HIGH);
  digitalWrite(BUZZER_PIN, HIGH);
  Serial.println("[ALARM] Alarm başlatıldı! (Butona basılana kadar ötecek)");

  // ESP-NOW ile bilekliğe sinyal gönder
  sendESPNowSignal();

  // Mobil uygulamaya "Alarm Çaldı" bilgisini gönder
  sendAlertToApp();
}

// Uygulamaya otonom alarmın başladığını haber ver (AlertOverlay çıkması için)
void sendAlertToApp() {
  if (Firebase.ready()) {
    FirebaseJson content;
    // Uygulama bu alanın güncellendiğini görünce lokal bildirim/AlertOverlay
    // çıkartabilir
    content.set("fields/lastAutonomousAlarm/stringValue", getCurrentTimeStr());

    String documentPath = "devices/" + deviceId;
    if (Firebase.Firestore.patchDocument(&fbdo, PROJECT_ID, "",
                                         documentPath.c_str(), content.raw(),
                                         "lastAutonomousAlarm")) {
      Serial.println("[Firebase] Uygulamaya bildirim gönderildi "
                     "(lastAutonomousAlarm güncellendi).");
    }
  }
}

// Uygulamaya ilacın kaçırıldığını (10 dk timeout) haber ver
void sendMissedAlertToApp() {
  if (Firebase.ready()) {
    FirebaseJson content;
    content.set("fields/lastMissedAlarm/stringValue", getCurrentTimeStr());

    String documentPath = "devices/" + deviceId;
    if (Firebase.Firestore.patchDocument(&fbdo, PROJECT_ID, "",
                                         documentPath.c_str(), content.raw(),
                                         "lastMissedAlarm")) {
      Serial.println("[Firebase] İlaç kaçırıldı (lastMissedAlarm) bildirildi.");
    }
  }
}

// Alarm durdur
void stopAlarm() {
  alarmActive = false;
  digitalWrite(LED_PIN, LOW);
  noTone(BUZZER_PIN);
  Serial.println("[ALARM] Alarm durduruldu.");
  
  // Bilekliğin de susması için DUR sinyali gönder
  sendESPNowStopSignal();
}

// ESP-NOW üzerinden bilekliğe "DUR" sinyali gönder
void sendESPNowStopSignal() {
  if (!espnowReady) return;
  
  espnow_message_t msg = {};
  strncpy(msg.deviceId, "esp32_medicine_box_01", sizeof(msg.deviceId) - 1);
  strncpy(msg.command, "DUR", sizeof(msg.command) - 1);
  msg.timestamp = millis();
  
  esp_now_send(broadcastAddress, (uint8_t*)&msg, sizeof(msg));
  Serial.println("[ESP-NOW] 📡 Bilekliğe DUR sinyali gönderildi.");
}

// ESP-NOW üzerinden bilekliğe "İlaç zamanı!" sinyali gönder
void sendESPNowSignal() {
  if (!espnowReady) {
    Serial.println("[ESP-NOW] ❌ ESP-NOW hazır değil!");
    return;
  }
  
  espnow_message_t msg = {};
  strncpy(msg.deviceId, "esp32_medicine_box_01", sizeof(msg.deviceId) - 1);
  strncpy(msg.command, "ILAC", sizeof(msg.command) - 1);
  msg.timestamp = millis();
  
  esp_err_t result = esp_now_send(broadcastAddress, (uint8_t*)&msg, sizeof(msg));
  if (result == ESP_OK) {
    Serial.println("[ESP-NOW] 📡 Bilekliğe sinyal gönderildi.");
  } else {
    Serial.printf("[ESP-NOW] ❌ Sinyal gönderilemedi! Hata: %d\n", result);
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
  content.set("fields/radioModule/stringValue", "ESP-NOW");
  content.set(
      "fields/pins/stringValue",
      "LED:4 | BZR:46 | BTN:36 | Radio:ESP-NOW(dahili)");

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
    tone(BUZZER_PIN, 2000); // 2000 Hz ince bir test sesi
    delay(150);
    digitalWrite(LED_PIN, LOW);
    noTone(BUZZER_PIN);
    delay(150);
  }
  Serial.println("[TEST] Tamamlandı.");
}

// Basit timestamp (Firebase için)
String getTimestamp() {
  time_t now = time(nullptr);
  return String(now);
}

/*
 * =========================================================
 *  CareSync – ESP32-S3 İlaç Kutusu (Ana Cihaz)
 *  Kart: ESP32-S3 2022 v1.3
 *
 *  Donanım Bağlantıları:
 *    NeoPixel LED → GPIO 4  (21 adet WS2812B - 7 gün x 3 öğün)
 *    Hoparlör     → GPIO 46  (2N2222A transistör ile)
 *    Button      → GPIO 36
 *    ESP-NOW     → Dahili (ESP32-S3 WiFi radyo)
 * =========================================================
 */

#include <ArduinoJson.h>
#include <Firebase_ESP_Client.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <addons/RTDBHelper.h>
#include <addons/TokenHelper.h>
#include <time.h>
#include <Adafruit_NeoPixel.h>

/* ─── ESP32-S3 Uyumluluğu ──────────────────────────────── */
// NRF24 kaldırıldı – ESP-NOW kullanılıyor

/* ─── WiFi Ayarları ─────────────────────────────────────── */
#define WIFI_SSID "Harun59"
#define WIFI_PASSWORD "Harun5959"

/* ─── Firebase Ayarları ─────────────────────────────────── */
#define API_KEY "AIzaSyDHII3X9MFkX5_HF6W5NtyosNyHFef9uDs"
#define DATABASE_URL "https://saglikbileklik-356ed-default-rtdb.europe-west1.firebasedatabase.app"
#define PROJECT_ID "saglikbileklik-356ed"
#define USER_EMAIL "test@test.com"
#define USER_PASSWORD "test123"

/* ─── Pin Tanımlamaları ────────────────────────────── */
#define NEOPIXEL_PIN 4     // 21 Adreslenebilir LED (WS2812B)
#define BUZZER_PIN 46      // Hoparlör (Transistör ile)
#define BUTTON_PIN 36      // Buton (ilaç alındı onayı)

/* ─── NeoPixel LED Ayarları ───────────────────── */
#define NUM_LEDS 21
#define LED_BRIGHTNESS 50  // 0-255 arası (%20 parlaklık = güç tasarrufu)
Adafruit_NeoPixel strip(NUM_LEDS, NEOPIXEL_PIN, NEO_GRB + NEO_KHZ800);

// LED Renkleri (Öğün Bazlı)
// Sabah (LED 0-6):  Yeşil tonları
// Öğle (LED 7-13):  Mavi tonları
// Akşam (LED 14-20): Mor tonları
uint32_t periodColors[3];

// Aktif alarm LED indeksi (-1 = alarm yok)
int alarmLedIndex = -1;

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
unsigned long lastESPNowSend = 0;  // ESP-NOW sinyal gönderim zamanlayıcı
bool beepState = false;

// Ses ayarları
int melodyType = 0; // 0: Standart, 1: Siren, 2: Hızlı, 3: Özel
int customFreq = 1000;
int customSpeed = 500;
int volume = 100;
bool testSoundActive = false;
unsigned long testSoundStartTime = 0;

// WiFi & Firebase bağlantı kurtarma
unsigned long lastWiFiCheck = 0;
const unsigned long WIFI_CHECK_INTERVAL = 30000; // 30 sn
unsigned long lastTokenCheck = 0;
const unsigned long TOKEN_CHECK_INTERVAL = 60000; // 1 dk
int firebaseFailCount = 0;
const int MAX_FIREBASE_FAILS = 3; // 3 ardışık hata sonrası token sıfırla

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
      // Ek DUR sinyali gönder (güvenilirlik için 2 kez)
      sendESPNowStopSignal();
      delay(50);
      sendESPNowStopSignal();
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
const unsigned long FIREBASE_INTERVAL = 5000; // 5 saniyede bir kontrol (alarm kaçırma riskini azaltmak için)


/* ─────────────────────────────────────────────────────────
   SETUP
   ───────────────────────────────────────────────────────── */
void setup() {
  Serial.begin(115200);
  delay(200);

  // Pin modları
  pinMode(NEOPIXEL_PIN, OUTPUT);
  strip.begin();
  strip.setBrightness(LED_BRIGHTNESS);
  strip.clear();
  strip.show();
  
  // Öğün renklerini ayarla
  periodColors[0] = strip.Color(0, 255, 50);   // Sabah = Yeşil
  periodColors[1] = strip.Color(0, 100, 255);   // Öğle = Mavi
  periodColors[2] = strip.Color(180, 0, 255);   // Akşam = Mor
  
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP); // Harici Buton
  pinMode(0, INPUT_PULLUP);          // Dahili BOOT Butonu

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
  config.database_url = DATABASE_URL;  // Token yenileme için gerekli!
  auth.user.email = USER_EMAIL;
  auth.user.password = USER_PASSWORD;
  config.token_status_callback = tokenStatusCallback;
  config.timeout.networkReconnect = 10000;   // 10 sn ağ yeniden bağlanma
  config.timeout.serverResponse = 10000;     // 10 sn sunucu cevap süresi
  config.timeout.socketConnection = 10000;   // 10 sn soket bağlantı

  Firebase.begin(&config, &auth);
  Firebase.reconnectNetwork(true);
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
  // ── WiFi Bağlantı Kontrolü & Otomatik Yeniden Bağlanma ──
  if (millis() - lastWiFiCheck > WIFI_CHECK_INTERVAL) {
    lastWiFiCheck = millis();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[WIFI] ❌ Bağlantı koptu! Yeniden bağlanılıyor...");
      WiFi.disconnect();
      delay(500);
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      int retries = 0;
      while (WiFi.status() != WL_CONNECTED && retries < 20) {
        delay(500);
        Serial.print(".");
        retries++;
      }
      if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n[WIFI] ✅ Yeniden bağlandı! IP: " + WiFi.localIP().toString());
        WiFi.softAP("CareSync_Box", "12345678", WiFi.channel(), 0);
        configTime(10800, 0, "pool.ntp.org", "time.nist.gov");
        firebaseFailCount = 0;
      } else {
        Serial.println("\n[WIFI] ❌ Hala bağlanamadı, sonraki döngüde tekrar deneyecek.");
      }
    }
  }

  // ── Firebase Token Kurtarma Mekanizması ──
  if (millis() - lastTokenCheck > TOKEN_CHECK_INTERVAL) {
    lastTokenCheck = millis();
    if (!Firebase.ready()) {
      firebaseFailCount++;
      Serial.printf("[FIREBASE] ⚠️ Token hazır değil! Ardışık hata: %d/%d\n", firebaseFailCount, MAX_FIREBASE_FAILS);
      if (firebaseFailCount >= MAX_FIREBASE_FAILS) {
        Serial.println("[FIREBASE] 🔄 Token sıfırlanıyor (connection lost kurtarma)...");
        Firebase.reset(&config);
        delay(1000);
        Firebase.begin(&config, &auth);
        Firebase.reconnectNetwork(true);
        Firebase.reconnectWiFi(true);
        firebaseFailCount = 0;
        Serial.println("[FIREBASE] ✅ Firebase yeniden başlatıldı!");
      }
    } else {
      if (firebaseFailCount > 0) {
        Serial.println("[FIREBASE] ✅ Token tekrar aktif.");
        firebaseFailCount = 0;
      }
    }
  }

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
      strip.clear();
      strip.show();
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
      
      if (melodyType == 0) { speedMs = 1000; freq1 = 1000; freq2 = 0; }
      else if (melodyType == 1) { speedMs = 300; freq1 = 800; freq2 = 1200; }
      else if (melodyType == 2) { speedMs = 150; freq1 = 2000; freq2 = 0; }
      else if (melodyType == 3) { speedMs = customSpeed; freq1 = customFreq; freq2 = 0; }

      if (currentMillis - lastBeepTime >= speedMs) {
        lastBeepTime = currentMillis;
        beepState = !beepState;
        
        // NeoPixel LED Animasyonu
        if (alarmActive && alarmLedIndex >= 0 && alarmLedIndex < NUM_LEDS) {
          // Alarm LED'i kırmızı-beyaz yanıp söner
          if (beepState) {
            strip.setPixelColor(alarmLedIndex, strip.Color(255, 0, 0)); // Kırmızı
          } else {
            strip.setPixelColor(alarmLedIndex, strip.Color(255, 255, 255)); // Beyaz
          }
          strip.show();
        } else if (testSoundActive) {
          // Test modunda gökkuşağı efekti
          for (int i = 0; i < NUM_LEDS; i++) {
            int hue = (i * 65536 / NUM_LEDS + currentMillis * 10) % 65536;
            strip.setPixelColor(i, strip.gamma32(strip.ColorHSV(hue)));
          }
          strip.show();
        }
        
      int duration = (speedMs * volume) / 100;
        
        if (beepState) {
          tone(BUZZER_PIN, freq1, duration);
        } else {
          if (freq2 > 0) {
            tone(BUZZER_PIN, freq2, duration);
          } else {
            noTone(BUZZER_PIN);
          }
        }
        
        // ESP-NOW: Bilekliğe periyodik sinyal (her 10 saniyede bir)
        // Her beep'te göndermek bilekliği tekrar tetikleyebilir!
        if (alarmActive && (currentMillis - lastESPNowSend >= 10000)) {
          lastESPNowSend = currentMillis;
          sendESPNowSignal();
          Serial.println("[ESP-NOW] 📡 Periyodik alarm sinyali gönderildi (10sn).");
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
  if (WiFi.status() == WL_CONNECTED && Firebase.ready() && 
      (millis() - lastFirebaseCheck > FIREBASE_INTERVAL || lastFirebaseCheck == 0)) {
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

// İki "HH:MM" zaman dizgesinin birbirine ±1 dakika mesafede olup olmadığını kontrol et
bool isWithinOneMinute(String time1, String time2) {
  if (time1.length() < 5 || time2.length() < 5) return false;
  
  int h1 = time1.substring(0, 2).toInt();
  int m1 = time1.substring(3, 5).toInt();
  int h2 = time2.substring(0, 2).toInt();
  int m2 = time2.substring(3, 5).toInt();
  
  int totalMin1 = h1 * 60 + m1;
  int totalMin2 = h2 * 60 + m2;
  
  int diff = abs(totalMin1 - totalMin2);
  // Gece yarısı geçişini hesaba kat (23:59 -> 00:00)
  if (diff > 720) diff = 1440 - diff;
  
  return diff <= 1;
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

    // YÖNTEM D: LED Testi Kontrolü
    bool testLed = doc["fields"]["testLed"]["booleanValue"] | false;

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
      if (settingsMap.containsKey("volume")) {
        int v = atoi(settingsMap["volume"]["integerValue"].as<const char*>());
        if (v > 0) volume = v;
      }
    }

    if (testSound && !testSoundActive) {
      Serial.println("[TEST] Firebase'den 'testSound=true' komutu geldi!");
      testSoundActive = true;
      testSoundStartTime = millis();
      lastBeepTime = millis();
      beepState = true;
      
      int startFreq = 1000;
      if (melodyType == 1) startFreq = 800;
      else if (melodyType == 2) startFreq = 2000;
      else if (melodyType == 3) startFreq = customFreq;
      
      int duration = 1000;
      if (melodyType == 1) duration = 300;
      else if (melodyType == 2) duration = 150;
      else if (melodyType == 3) duration = customSpeed;
      
      tone(BUZZER_PIN, startFreq, (duration * volume) / 100);
      
      FirebaseJson content;
      content.set("fields/testSound/booleanValue", false);
      String documentPath = "devices/" + deviceId;
      Firebase.Firestore.patchDocument(&fbdo, PROJECT_ID, "", documentPath.c_str(), content.raw(), "testSound");
    }

    if (testLed) {
      Serial.println("[TEST] Firebase'den 'testLed=true' komutu geldi! LED'ler test ediliyor...");
      startupSequence();
      
      FirebaseJson content;
      content.set("fields/testLed/booleanValue", false);
      String documentPath = "devices/" + deviceId;
      Firebase.Firestore.patchDocument(&fbdo, PROJECT_ID, "", documentPath.c_str(), content.raw(), "testLed");
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
      DynamicJsonDocument schedDoc(4096);
      DeserializationError schedError =
          deserializeJson(schedDoc, scheduleJSONStr);

      if (!schedError) {
        JsonObject root = schedDoc.as<JsonObject>();
        // Bugünün saatlerini kontrol et
        JsonArray todayAlarms = root[currentDay.c_str()];
        bool shouldAlarm = false;
        int matchedPeriod = -1;

        Serial.println("[DEBUG] İncelenen Gün: " + currentDay +
                       " | Mevcut Saat: " + currentTime);
        Serial.print("[DEBUG] Bu Gün İçin Ayarlı Saatler: ");

        if (todayAlarms.isNull() || todayAlarms.size() == 0) {
          Serial.println("(Hiç alarm yok)");
        } else {
          for (JsonVariant value : todayAlarms) {
            // Yeni format: {"t":"08:00","p":0}
            // Eski format uyumluluğu: salt string "08:00"
            String alarmTime;
            int period = 0;
            
            if (value.is<JsonObject>()) {
              alarmTime = value["t"].as<String>();
              period = value["p"] | 0;
            } else {
              alarmTime = value.as<String>();
            }
            alarmTime.trim();
            Serial.print(alarmTime + "(p" + String(period) + ") ");
            
            // Tam eşleşme VEYA ±1 dakika tolerans kontrolü
            if (alarmTime == currentTime || isWithinOneMinute(currentTime, alarmTime)) {
              shouldAlarm = true;
              matchedPeriod = period;
            }
          }
          Serial.println("");
        }

        if (shouldAlarm) {
          if (lastTriggeredAlarmTime != currentTime && !alarmActive) {
            Serial.println("[ALARM] Programlanan saat geldi: " + currentTime);
            lastTriggeredAlarmTime = currentTime;
            
            // LED indeksini hesapla: (period * 7) + day
            int dayInt = currentDay.toInt();
            if (matchedPeriod >= 0 && matchedPeriod <= 2 && dayInt >= 0 && dayInt <= 6) {
              alarmLedIndex = (matchedPeriod * 7) + dayInt;
            } else {
              alarmLedIndex = dayInt; // Fallback: sadece gün
            }
            Serial.printf("[LED] Alarm LED indeksi: %d (Gün:%d, Öğün:%d)\n", alarmLedIndex, dayInt, matchedPeriod);
            triggerAlarm();
          } else if (lastTriggeredAlarmTime == currentTime) {
            Serial.println("[DEBUG] Alarm bu dakika içinde zaten tetiklendi.");
          }
        } else {
          // Alarm saati 2+ dakika geçtiyse sıfırla (bir sonraki alarm tetiklenebilsin)
          if (lastTriggeredAlarmTime != "" && !isWithinOneMinute(currentTime, lastTriggeredAlarmTime)) {
            lastTriggeredAlarmTime = "";
          }
        }
      } else {
        Serial.println("[JSON Hata] scheduleJSON parse edilemedi.");
      }
    }
  } else {
    String errMsg = fbdo.errorReason();
    Serial.println("[Firebase] Hata: " + errMsg);
    // Token hatası tespit edilirse sayacı artır
    if (errMsg.indexOf("token") >= 0 || errMsg.indexOf("connection lost") >= 0) {
      firebaseFailCount++;
      Serial.printf("[FIREBASE] ⚠️ Token/bağlantı hatası! Sayaç: %d/%d\n", firebaseFailCount, MAX_FIREBASE_FAILS);
    }
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
  
  // İlgili LED'i kırmızı yak
  if (alarmLedIndex >= 0 && alarmLedIndex < NUM_LEDS) {
    strip.clear();
    strip.setPixelColor(alarmLedIndex, strip.Color(255, 0, 0));
    strip.show();
  }
  
  Serial.printf("[ALARM] Alarm başlatıldı! LED:%d (Butona basılana kadar ötecek)\n", alarmLedIndex);

  // ESP-NOW ile bilekliğe ilk sinyal gönder
  lastESPNowSend = millis();  // Zamanlayıcıyı başlat
  sendESPNowSignal();
  delay(100);
  sendESPNowSignal();  // Güvenilirlik için 2. sinyal

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
  noTone(BUZZER_PIN);
  
  // İlaç alındı efekti: İlgili LED yeşile döner, 1 sn sonra söner
  if (alarmLedIndex >= 0 && alarmLedIndex < NUM_LEDS) {
    strip.setPixelColor(alarmLedIndex, strip.Color(0, 255, 0)); // Yeşil = Alındı
    strip.show();
    delay(1000);
  }
  strip.clear();
  strip.show();
  alarmLedIndex = -1;
  
  Serial.println("[ALARM] Alarm durduruldu.");
  
  // Bilekliğin de susması için DUR sinyali gönder (2 kez — güvenilirlik)
  sendESPNowStopSignal();
  delay(50);
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
      "NeoPixel:4(21LED) | SPK:46 | BTN:36 | Radio:ESP-NOW");

  String documentPath = "devices/" + deviceId;
  if (Firebase.Firestore.patchDocument(
          &fbdo, PROJECT_ID, "", documentPath.c_str(), content.raw(),
          "status,type,batteryLevel,signalStrength,radioModule,pins")) {
    Serial.println("[Firebase] Cihaz durumu güncellendi: " + status);
  } else {
    Serial.println("[Firebase] Güncelleme hatası: " + fbdo.errorReason());
  }
}

// Başlangıç testi: Gökkuşağı dalgası + kısa bip
void startupSequence() {
  Serial.println("[TEST] Donanım testi (21 LED Gökkuşağı)...");
  
  // Gökkuşağı dalgası: LED'ler sırayla farklı renklerde yanar
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < NUM_LEDS; i++) {
      int hue = (i * 65536 / NUM_LEDS);
      strip.clear();
      strip.setPixelColor(i, strip.gamma32(strip.ColorHSV(hue)));
      strip.show();
      tone(BUZZER_PIN, 1000 + (i * 100), 30);
      delay(60);
    }
  }
  
  // Tüm LED'leri öğün renklerinde 1 sn göster
  for (int i = 0; i < 7; i++) {
    strip.setPixelColor(i, periodColors[0]);      // Sabah yeşil
    strip.setPixelColor(i + 7, periodColors[1]);  // Öğle mavi
    strip.setPixelColor(i + 14, periodColors[2]); // Akşam mor
  }
  strip.show();
  tone(BUZZER_PIN, 2000, 200);
  delay(1000);
  
  strip.clear();
  strip.show();
  noTone(BUZZER_PIN);
  Serial.println("[TEST] Tamamlandı.");
}

// Basit timestamp (Firebase için)
String getTimestamp() {
  time_t now = time(nullptr);
  return String(now);
}

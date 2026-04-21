/*
 * =========================================================
 *  CareSync – ESP32 İlaç Kutusu (Ana Cihaz)
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

#include "addons/RTDBHelper.h"
#include "addons/TokenHelper.h"
#include <Firebase_ESP_Client.h>
#include <RF24.h>
#include <SPI.h>
#include <WiFi.h>

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

// NRF24L01 SPI Pinleri (VSPI)
#define NRF_MOSI 5
#define NRF_MISO 6
#define NRF_SCK 7
#define NRF_CE 15
#define NRF_CSN 16

/* ─── NRF24L01 Kurulumu ──────────────────────────────────── */
// ESP32 üzerinde VSPI kullanarak özel SPI kurulumu
SPIClass vspi(VSPI);
RF24 radio(NRF_CE, NRF_CSN); // CE, CSN

// NRF24 haberleşme kanalı (her iki cihazda aynı olmalı)
const byte address[6] = "ILACK";

/* ─── Firebase Nesneleri ─────────────────────────────────── */
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

/* ─── Zamanlama ──────────────────────────────────────────── */
unsigned long lastFirebaseCheck = 0;
const unsigned long FIREBASE_INTERVAL = 15000; // 15 saniyede bir kontrol

/* ─── Durum Bayrakları ───────────────────────────────────── */
String deviceId = "esp32_medicine_box_01";
bool alarmActive = false;
bool buttonPressed = false;

/* ─────────────────────────────────────────────────────────
   SETUP
   ───────────────────────────────────────────────────────── */
void setup() {
  Serial.begin(115200);
  delay(200);

  // Pin modları
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP); // Buton: LOW = basılı

  digitalWrite(LED_PIN, LOW);
  digitalWrite(BUZZER_PIN, LOW);

  Serial.println("=== CareSync ESP32 Başlıyor ===");

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
    radio.stopListening(); // Bu cihaz verici (TX)
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

  // ── Buton Kontrolü ──
  if (digitalRead(BUTTON_PIN) == LOW) {
    delay(50); // Debounce
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
  if (Firebase.ready() && (millis() - lastFirebaseCheck > FIREBASE_INTERVAL ||
                           lastFirebaseCheck == 0)) {
    lastFirebaseCheck = millis();
    checkFirebaseAlarm();
  }
}

/* ─────────────────────────────────────────────────────────
   FONKSİYONLAR
   ───────────────────────────────────────────────────────── */

// Firebase'den alarm gelip gelmediğini kontrol et
void checkFirebaseAlarm() {
  String documentPath = "devices/" + deviceId;

  if (Firebase.Firestore.getDocument(&fbdo, PROJECT_ID, "",
                                     documentPath.c_str(), "")) {
    // Dönen JSON içinden 'triggerAlert' alanını okuyabilirsiniz
    // Örnek: FirebaseJson olarak parse edip kontrol et
    Serial.println("[Firebase] Belge alındı. Alarm kontrolü yapılıyor...");

    // TODO: fbdo.payload() içinden 'triggerAlert' = true olup olmadığını parse
    // et Şimdilik doğrudan triggerAlarm() çağırıyoruz (test amaçlı)
    // triggerAlarm();
  } else {
    Serial.println("[Firebase] Hata: " + fbdo.errorReason());
  }
}

// Alarm başlat: LED yak + Buzzer çal + NRF24 ile bilekliğe sinyal gönder
void triggerAlarm() {
  alarmActive = true;
  Serial.println("[ALARM] Alarm başlatıldı!");

  // NRF24 ile bilekliğe sinyal gönder
  sendNRFSignal();

  // LED ve Buzzer
  for (int i = 0; i < 3; i++) {
    digitalWrite(LED_PIN, HIGH);
    digitalWrite(BUZZER_PIN, HIGH);
    delay(400);
    digitalWrite(LED_PIN, LOW);
    digitalWrite(BUZZER_PIN, LOW);
    delay(200);
  }

  // LED yanık kalsın (buton basılana kadar)
  digitalWrite(LED_PIN, HIGH);
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
  // Gerçek implementasyonda NTP ile senkronize edilmeli
  return String(millis());
}

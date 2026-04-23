/*
 * =========================================================
 *  CareSync – ESP32 Bileklik (Alıcı Cihaz)
 *
 *  NOT: Bu kod eğer ikinci bir ESP32 bileklik cihazı
 *  kullanılacaksa yüklenir. Tek ESP32 kullanılıyorsa
 *  sadece esp32_medicine_box.ino yeterlidir.
 *
 *  Donanım Bağlantıları (Bileklik ESP32):
 *    LED      → GPIO 4
 *    Buzzer   → GPIO 46
 *    Button   → GPIO 36  (ilaç alındı onayı)
 *
 *  NRF24L01:
 *    MOSI     → GPIO 5
 *    MISO     → GPIO 6
 *    SCK      → GPIO 7
 *    CE       → GPIO 15
 *    CSN      → GPIO 16
 * =========================================================
 */

#include <SPI.h>
#include <RF24.h>

// ESP32-S3 uyumluluğu: VSPI tanımlı değilse FSPI kullan
#ifndef VSPI
  #define VSPI FSPI
#endif

/* ─── Pin Tanımlamaları ──────────────────────────────────── */
#define LED_PIN     4    // Uyarı LED'i
#define BUZZER_PIN  46   // Buzzer
#define BUTTON_PIN  36   // Buton (ilaç alındı onayı)

// NRF24L01 SPI Pinleri
#define NRF_MOSI    5
#define NRF_MISO    6
#define NRF_SCK     7
#define NRF_CE      15
#define NRF_CSN     16

/* ─── NRF24L01 Kurulumu ──────────────────────────────────── */
SPIClass vspi(VSPI);
RF24 radio(NRF_CE, NRF_CSN);

// Ana cihaz (ilaç kutusu) ile aynı kanal
const byte address[6] = "ILACK";

/* ─── Durum Değişkenleri ─────────────────────────────────── */
bool alarmActive  = false;
bool buttonPressed = false;

/* ─────────────────────────────────────────────────────────
   SETUP
   ───────────────────────────────────────────────────────── */
void setup() {
  Serial.begin(115200);

  pinMode(LED_PIN,    OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  digitalWrite(LED_PIN,    LOW);
  digitalWrite(BUZZER_PIN, LOW);

  Serial.println("=== CareSync Bileklik Alıcı Başlıyor ===");

  // SPI Başlat
  vspi.begin(NRF_SCK, NRF_MISO, NRF_MOSI, NRF_CSN);
  delay(50);

  // NRF24L01 Başlat
  if (!radio.begin(&vspi)) {
    Serial.println("[HATA] NRF24L01 başlatılamadı!");
    blinkError();
  } else {
    radio.openReadingPipe(0, address);
    radio.setPALevel(RF24_PA_HIGH);
    radio.setDataRate(RF24_250KBPS);
    radio.startListening();  // Bu cihaz alıcı (RX)
    Serial.println("[OK] NRF24L01 alıcı modda, sinyal bekleniyor...");
  }

  // Başlangıç testi
  startupTest();
}

/* ─────────────────────────────────────────────────────────
   LOOP
   ───────────────────────────────────────────────────────── */
void loop() {

  // ── NRF24 Sinyal Kontrolü ──
  if (radio.available()) {
    char msg[32] = "";
    radio.read(&msg, sizeof(msg));
    Serial.print("[NRF24] Sinyal alındı: ");
    Serial.println(msg);

    // "ILAC" mesajı geldiyse alarm başlat
    if (strcmp(msg, "ILAC") == 0) {
      triggerAlarm();
    }
  }

  // ── Buton Kontrolü ──
  if (digitalRead(BUTTON_PIN) == LOW) {
    delay(50); // Debounce
    if (digitalRead(BUTTON_PIN) == LOW && !buttonPressed) {
      buttonPressed = true;
      Serial.println("[BUTON] İlaç alındı!");

      if (alarmActive) {
        stopAlarm();
      }
    }
  } else {
    buttonPressed = false;
  }
}

/* ─────────────────────────────────────────────────────────
   FONKSİYONLAR
   ───────────────────────────────────────────────────────── */

// Alarm başlat
void triggerAlarm() {
  alarmActive = true;
  Serial.println("[ALARM] Alarm aktif!");

  // 3 kez LED + Buzzer birlikte çal
  for (int i = 0; i < 3; i++) {
    digitalWrite(LED_PIN,    HIGH);
    digitalWrite(BUZZER_PIN, HIGH);
    delay(500);
    digitalWrite(LED_PIN,    LOW);
    digitalWrite(BUZZER_PIN, LOW);
    delay(300);
  }

  // LED yanık kalsın, buton basılmayı bekle
  digitalWrite(LED_PIN, HIGH);
}

// Alarm durdur
void stopAlarm() {
  alarmActive = false;
  digitalWrite(LED_PIN,    LOW);
  digitalWrite(BUZZER_PIN, LOW);
  Serial.println("[ALARM] Durduruldu – İlaç alındı.");
}

// NRF24 hata göstergesi (3 hızlı blink)
void blinkError() {
  for (int i = 0; i < 6; i++) {
    digitalWrite(LED_PIN, HIGH);
    delay(100);
    digitalWrite(LED_PIN, LOW);
    delay(100);
  }
}

// Başlangıç testi
void startupTest() {
  for (int i = 0; i < 2; i++) {
    digitalWrite(LED_PIN,    HIGH);
    digitalWrite(BUZZER_PIN, HIGH);
    delay(150);
    digitalWrite(LED_PIN,    LOW);
    digitalWrite(BUZZER_PIN, LOW);
    delay(150);
  }
  Serial.println("[TEST] Donanım testi tamamlandı.");
}

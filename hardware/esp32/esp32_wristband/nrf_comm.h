/*
 * =========================================================
 *  CareSync – NRF24L01 Haberleşme Modülü
 *  
 *  İlaç kutusu (TX) ↔ Bileklik (RX) arasında 2.4GHz RF
 *  haberleşme. Çift yönlü destek:
 *  - İlaç kutusundan "ILAC" mesajı alma → alarm tetikleme
 *  - Bileklikten "ONAY" mesajı gönderme → ilaç alındı bildirimi
 * =========================================================
 */

#ifndef NRF_COMM_H
#define NRF_COMM_H

#include <Arduino.h>
#include <SPI.h>
#include <RF24.h>
#include "config.h"

// ESP32-S3 SPI uyumluluğu
#ifndef VSPI
  #define VSPI FSPI
#endif

// NRF24L01 mesaj tipleri
#define NRF_MSG_MEDICINE    "ILAC"   // İlaç kutusu → bileklik
#define NRF_MSG_CONFIRM     "ONAY"   // Bileklik → ilaç kutusu
#define NRF_MSG_PING        "PING"   // Bağlantı testi
#define NRF_MSG_PONG        "PONG"   // Ping yanıtı

// Callback fonksiyon tipi
typedef void (*NRFMessageCallback)(const char* message);

class NRFComm {
public:
  bool isReady = false;
  int8_t signalStrength = 0;  // RSSI benzeri güç göstergesi

  /* ─── Başlatma ──────────────────────────────────────── */
  bool begin() {
    DEBUG_PRINTLN("[NRF] NRF24L01 başlatılıyor...");

    // SPI başlat (ESP32-S3 özel pin ataması)
    _spi = new SPIClass(VSPI);
    _spi->begin(NRF_SCK, NRF_MISO, NRF_MOSI, NRF_CSN);
    delay(50);

    // Radio başlat
    _radio = new RF24(NRF_CE, NRF_CSN);

    if (!_radio->begin(_spi)) {
      DEBUG_PRINTLN("[NRF] ❌ NRF24L01 başlatılamadı! Kablo bağlantılarını kontrol edin.");
      isReady = false;
      return false;
    }

    // Kanal ve güç ayarları
    _radio->setPALevel(RF24_PA_HIGH);      // Yüksek güç (uzun menzil)
    _radio->setDataRate(RF24_250KBPS);     // Düşük hız = daha iyi menzil
    _radio->setPayloadSize(32);            // Sabit payload boyutu
    _radio->setAutoAck(true);              // Otomatik ACK aktif
    _radio->setRetries(5, 15);             // 5*250µs bekleme, 15 tekrar

    // Pipe'ları aç
    const byte addr[6] = NRF_PIPE_ADDRESS;
    _radio->openReadingPipe(0, addr);      // Okuma pipe'ı (RX)
    _radio->openWritingPipe(addr);         // Yazma pipe'ı (TX)

    // Varsayılan: Alıcı (RX) modda başla
    _radio->startListening();

    isReady = true;
    DEBUG_PRINTLN("[NRF] ✅ NRF24L01 hazır (RX modda).");
    DEBUG_PRINTF("[NRF] Kanal: %d | PA: HIGH | Hız: 250KBPS\n", _radio->getChannel());

    return true;
  }

  /* ─── Gelen Mesaj Kontrolü (loop içinde çağır) ─────── */
  bool checkForMessages() {
    if (!isReady || !_radio) return false;

    if (_radio->available()) {
      char msg[32] = "";
      _radio->read(&msg, sizeof(msg));

      DEBUG_PRINT("[NRF] 📨 Mesaj alındı: ");
      DEBUG_PRINTLN(msg);

      // Mesaj tipini belirle
      if (strcmp(msg, NRF_MSG_MEDICINE) == 0) {
        _lastMessageType = ALARM_TYPE_MEDICINE;
        if (_onMedicineAlert) _onMedicineAlert(msg);
        return true;
      }
      else if (strcmp(msg, NRF_MSG_PING) == 0) {
        // Ping'e otomatik pong yanıtı
        sendMessage(NRF_MSG_PONG);
        DEBUG_PRINTLN("[NRF] 🏓 PING alındı, PONG gönderildi.");
        return true;
      }

      return true;
    }

    return false;
  }

  /* ─── Mesaj Gönder (TX moduna geçip geri döner) ────── */
  bool sendMessage(const char* msg) {
    if (!isReady || !_radio) return false;

    // RX → TX moduna geç
    _radio->stopListening();
    delay(5);

    bool success = _radio->write(msg, strlen(msg) + 1);

    // TX → RX moduna geri dön
    _radio->startListening();

    if (success) {
      DEBUG_PRINTF("[NRF] ✅ Mesaj gönderildi: %s\n", msg);
    } else {
      DEBUG_PRINTF("[NRF] ❌ Mesaj gönderilemedi: %s\n", msg);
    }

    return success;
  }

  /* ─── İlaç Alındı Onayını Gönder ──────────────────── */
  bool sendMedicineConfirm() {
    DEBUG_PRINTLN("[NRF] 💊 İlaç onay sinyali gönderiliyor...");
    return sendMessage(NRF_MSG_CONFIRM);
  }

  /* ─── Callback Ayarla ──────────────────────────────── */
  void onMedicineAlert(NRFMessageCallback callback) {
    _onMedicineAlert = callback;
  }

  /* ─── Son Mesaj Tipi ───────────────────────────────── */
  uint8_t getLastMessageType() {
    return _lastMessageType;
  }

  void clearLastMessage() {
    _lastMessageType = 0;
  }

  /* ─── Güç Tasarrufu: NRF24'ü uyut/uyandır ─────────── */
  void powerDown() {
    if (_radio && isReady) {
      _radio->powerDown();
      DEBUG_PRINTLN("[NRF] 💤 NRF24 uyku moduna alındı.");
    }
  }

  void powerUp() {
    if (_radio && isReady) {
      _radio->powerUp();
      _radio->startListening();
      delay(5);
      DEBUG_PRINTLN("[NRF] ⚡ NRF24 uyandırıldı.");
    }
  }

private:
  SPIClass* _spi    = nullptr;
  RF24*     _radio  = nullptr;
  uint8_t   _lastMessageType = 0;
  NRFMessageCallback _onMedicineAlert = nullptr;
};

#endif // NRF_COMM_H

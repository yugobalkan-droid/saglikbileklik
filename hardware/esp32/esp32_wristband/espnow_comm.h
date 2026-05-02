/*
 * =========================================================
 *  CareSync – ESP-NOW Haberleşme Modülü
 *  
 *  İlaç kutusu (TX) ↔ Bileklik (RX) arasında ESP-NOW ile
 *  2.4GHz haberleşme. NRF24L01 yerine ESP32 dahili radyo
 *  kullanır – ek donanım gerekmez!
 *
 *  Çift yönlü destek:
 *  - İlaç kutusundan "ILAC" mesajı alma → alarm tetikleme
 *  - Bileklikten "ONAY" mesajı gönderme → ilaç alındı bildirimi
 * =========================================================
 */

#ifndef ESPNOW_COMM_H
#define ESPNOW_COMM_H

#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include "config.h"

#define ESPNOW_MSG_MEDICINE    "ILAC"   // İlaç kutusu → bileklik
#define ESPNOW_MSG_CONFIRM     "ONAY"   // Bileklik → ilaç kutusu
#define ESPNOW_MSG_STOP        "DUR"    // İlaç kutusu → bileklik (Alarmı durdur)
#define ESPNOW_MSG_PING        "PING"   // Bağlantı testi
#define ESPNOW_MSG_PONG        "PONG"   // Ping yanıtı

// Callback fonksiyon tipi
typedef void (*ESPNowMessageCallback)(const char* message);

/* ─── Mesaj Yapısı ──────────────────────────────────────── */
// ESP-NOW ile gönderilecek/alınacak yapı
typedef struct espnow_message_t {
  char deviceId[20];   // Gönderen cihaz kimliği
  char command[10];    // Komut: "ILAC", "ONAY", "PING", "PONG"
  uint32_t timestamp;  // millis() zaman damgası
} espnow_message_t;

/* ─── Global Callback Referansları ──────────────────────── */
// ESP-NOW callback'leri static olmalı, bu yüzden global pointer kullanıyoruz
static ESPNowMessageCallback _globalMedicineCallback = nullptr;
static ESPNowMessageCallback _globalStopCallback = nullptr;
static bool _espnowReady = false;

/* ─── ESP-NOW Alım Callback'i (static) ─────────────────── */
#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 0, 0)
// ESP-IDF v5+ (Arduino ESP32 Core 3.x) callback imzası
static void onESPNowDataRecv(const esp_now_recv_info_t *info, const uint8_t *data, int dataLen) {
#else
// ESP-IDF v4.x (Arduino ESP32 Core 2.x) callback imzası
static void onESPNowDataRecv(const uint8_t *mac, const uint8_t *data, int dataLen) {
#endif
  if (dataLen != sizeof(espnow_message_t)) {
    DEBUG_PRINTLN("[ESP-NOW] ⚠️ Beklenmeyen veri boyutu, atlanıyor.");
    return;
  }

  espnow_message_t msg;
  memcpy(&msg, data, sizeof(msg));

  DEBUG_PRINTF("[ESP-NOW] 📨 Mesaj alındı: cmd=%s, from=%s\n", msg.command, msg.deviceId);

  // Mesaj tipini belirle
  if (strcmp(msg.command, ESPNOW_MSG_MEDICINE) == 0) {
    DEBUG_PRINTLN("[ESP-NOW] 💊 İlaç alarm sinyali alındı!");
    if (_globalMedicineCallback) {
      _globalMedicineCallback(msg.command);
    }
  }
  else if (strcmp(msg.command, ESPNOW_MSG_STOP) == 0) {
    DEBUG_PRINTLN("[ESP-NOW] 🛑 DUR sinyali alındı!");
    if (_globalStopCallback) {
      _globalStopCallback(msg.command);
    }
  }
  else if (strcmp(msg.command, ESPNOW_MSG_PING) == 0) {
    DEBUG_PRINTLN("[ESP-NOW] 🏓 PING alındı.");
    // TODO: PONG yanıtı gönderilebilir
  }
}

/* ─── ESP-NOW Gönderim Callback'i (static) ─────────────── */
#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 0, 0)
// ESP-IDF v5+ (Arduino ESP32 Core 3.x) callback imzası
static void onESPNowDataSent(const wifi_tx_info_t *info, esp_now_send_status_t status) {
#else
static void onESPNowDataSent(const uint8_t *mac_addr, esp_now_send_status_t status) {
#endif
  if (status == ESP_NOW_SEND_SUCCESS) {
    DEBUG_PRINTLN("[ESP-NOW] ✅ Mesaj gönderildi.");
  } else {
    DEBUG_PRINTLN("[ESP-NOW] ❌ Mesaj gönderilemedi!");
  }
}

/* ═══════════════════════════════════════════════════════════
   ESPNowComm Sınıfı
   ═══════════════════════════════════════════════════════════ */
class ESPNowComm {
public:
  bool isReady = false;

  /* ─── Dinamik Kanal Bulma ────────────────────────────── */
  int32_t findChannel() {
    DEBUG_PRINTLN("[ESP-NOW] 📡 Dinamik WiFi kanalı aranıyor (CareSync_Box)...");
    WiFi.mode(WIFI_STA);
    WiFi.disconnect();
    
    // Kutu daha yavaş açılabilir diye 3 kez taramayı deniyoruz
    for (int attempt = 1; attempt <= 3; attempt++) {
      DEBUG_PRINTF("[ESP-NOW] Tarama Denemesi %d/3...\n", attempt);
      int n = WiFi.scanNetworks(false, false); // false = show hidden argümanı kapalı, çünkü artık AP görünür
      for (int i = 0; i < n; ++i) {
        if (WiFi.SSID(i) == "CareSync_Box" || WiFi.SSID(i) == "Harun59") {
          int32_t channel = WiFi.channel(i);
          DEBUG_PRINTF("[ESP-NOW] 🎯 Ağ bulundu (%s)! Kanal: %d\n", WiFi.SSID(i).c_str(), channel);
          return channel;
        }
      }
      if (attempt < 3) {
        DEBUG_PRINTLN("[ESP-NOW] ⏳ Bulunamadı, 2 saniye sonra tekrar aranacak...");
        delay(2000);
      }
    }
    
    DEBUG_PRINTF("[ESP-NOW] ⚠️ Kutu bulunamadı, varsayılan kanal %d kullanılacak.\n", ESPNOW_CHANNEL);
    return ESPNOW_CHANNEL; // Default fallback
  }

  /* ─── Başlatma ──────────────────────────────────────── */
  bool begin() {
    DEBUG_PRINTLN("[ESP-NOW] ESP-NOW başlatılıyor...");

    // Dinamik kanal bul
    int32_t targetChannel = findChannel();

    // WiFi'ı STA modunda başlat (ağa bağlanmadan, sadece radyo için)
    WiFi.mode(WIFI_STA);
    WiFi.disconnect();  // Herhangi bir ağa bağlanma
    delay(100);

    // WiFi kanalını ilaç kutusu ile aynı kanala ayarla
    esp_wifi_set_channel(targetChannel, WIFI_SECOND_CHAN_NONE);

    // ESP-NOW başlat
    if (esp_now_init() != ESP_OK) {
      DEBUG_PRINTLN("[ESP-NOW] ❌ ESP-NOW başlatılamadı!");
      isReady = false;
      _espnowReady = false;
      return false;
    }

    // Callback'leri kaydet
    esp_now_register_recv_cb(onESPNowDataRecv);
    esp_now_register_send_cb(onESPNowDataSent);

    // Broadcast peer ekle (tüm cihazlara gönderebilmek için)
    esp_now_peer_info_t peerInfo = {};
    memcpy(peerInfo.peer_addr, _broadcastAddr, 6);
    peerInfo.channel = targetChannel;
    peerInfo.encrypt = false;

    if (esp_now_add_peer(&peerInfo) != ESP_OK) {
      DEBUG_PRINTLN("[ESP-NOW] ⚠️ Broadcast peer eklenemedi!");
      // Yine de devam et, zaten ekli olabilir
    }

    isReady = true;
    _espnowReady = true;

    // MAC adresini yazdır
    uint8_t mac[6];
    WiFi.macAddress(mac);
    DEBUG_PRINTF("[ESP-NOW] ✅ ESP-NOW hazır! Kanal: %d\n", targetChannel);
    DEBUG_PRINTF("[ESP-NOW] 📟 Bu cihazın MAC: %02X:%02X:%02X:%02X:%02X:%02X\n",
                 mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

    return true;
  }

  /* ─── Mesaj Gönder (Broadcast) ─────────────────────── */
  bool sendMessage(const char* cmd) {
    if (!isReady) return false;

    espnow_message_t msg = {};
    strncpy(msg.deviceId, DEVICE_ID, sizeof(msg.deviceId) - 1);
    strncpy(msg.command, cmd, sizeof(msg.command) - 1);
    msg.timestamp = millis();

    esp_err_t result = esp_now_send(_broadcastAddr, (uint8_t*)&msg, sizeof(msg));

    if (result == ESP_OK) {
      DEBUG_PRINTF("[ESP-NOW] 📤 Mesaj gönderiliyor: %s\n", cmd);
      return true;
    } else {
      DEBUG_PRINTF("[ESP-NOW] ❌ Gönderim hatası: %d\n", result);
      return false;
    }
  }

  /* ─── İlaç Alındı Onayını Gönder ──────────────────── */
  bool sendMedicineConfirm() {
    DEBUG_PRINTLN("[ESP-NOW] 💊 İlaç onay sinyali gönderiliyor...");
    return sendMessage(ESPNOW_MSG_CONFIRM);
  }

  /* ─── Callback Ayarla ──────────────────────────────── */
  void onMedicineAlert(ESPNowMessageCallback callback) {
    _globalMedicineCallback = callback;
  }

  void onStopAlert(ESPNowMessageCallback callback) {
    _globalStopCallback = callback;
  }

  /* ─── Güç Tasarrufu ────────────────────────────────── */
  void powerDown() {
    if (isReady) {
      esp_now_deinit();
      WiFi.mode(WIFI_OFF);
      isReady = false;
      _espnowReady = false;
      DEBUG_PRINTLN("[ESP-NOW] 💤 ESP-NOW kapatıldı.");
    }
  }

  void powerUp() {
    if (!isReady) {
      begin();
      DEBUG_PRINTLN("[ESP-NOW] ⚡ ESP-NOW yeniden başlatıldı.");
    }
  }

private:
  // Broadcast MAC adresi (tüm cihazlara gönderim)
  uint8_t _broadcastAddr[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
};

#endif // ESPNOW_COMM_H

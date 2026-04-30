/*
 * =========================================================
 *  CareSync – BLE Servis Modülü
 *  
 *  ESP32-S3 dahili BLE 5.0 ile mobil uygulama bağlantısı.
 *  Sunulan veriler:
 *    - Pil seviyesi (%)
 *    - Şarj durumu
 *    - Alarm durumu (okunabilir + yazılabilir)
 *    - İlaç onay bildirimi
 *    - Cihaz bilgisi
 * =========================================================
 */

#ifndef BLE_SERVICE_H
#define BLE_SERVICE_H

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include "config.h"

// Callback fonksiyon tipleri
typedef void (*BLEAlarmCallback)(bool activate);

class CareSyncBLE {
public:
  bool isConnected   = false;
  bool isAdvertising = false;

  /* ─── BLE Başlatma ─────────────────────────────────── */
  void begin() {
    DEBUG_PRINTLN("[BLE] BLE servisi başlatılıyor...");

    // BLE cihazını oluştur
    BLEDevice::init(DEVICE_NAME);

    // BLE güç seviyesi (pil tasarrufu için düşük tut)
    BLEDevice::setPower(ESP_PWR_LVL_P3);  // +3dBm (orta güç)

    // BLE Server oluştur
    _pServer = BLEDevice::createServer();
    _pServer->setCallbacks(new ServerCallbacks(this));

    // ── Ana CareSync Servisi ──
    _pService = _pServer->createService(BLEUUID(BLE_SERVICE_UUID), 20);

    // ── Karakteristikler ──

    // 1. Pil Seviyesi (READ + NOTIFY)
    _pBatteryChar = _pService->createCharacteristic(
      BLEUUID(BLE_CHAR_BATTERY_UUID),
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
    );
    _pBatteryChar->addDescriptor(new BLE2902());
    uint8_t initBattery = 0;
    _pBatteryChar->setValue(&initBattery, 1);

    // 2. Şarj Durumu (READ + NOTIFY)
    _pChargeChar = _pService->createCharacteristic(
      BLEUUID(BLE_CHAR_CHARGE_UUID),
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
    );
    _pChargeChar->addDescriptor(new BLE2902());
    uint8_t initCharge = 0;
    _pChargeChar->setValue(&initCharge, 1);

    // 3. Alarm Durumu (READ + NOTIFY + WRITE)
    // App alarm tetikleyebilir veya durdurabilir
    _pAlarmChar = _pService->createCharacteristic(
      BLEUUID(BLE_CHAR_ALARM_UUID),
      BLECharacteristic::PROPERTY_READ |
      BLECharacteristic::PROPERTY_NOTIFY |
      BLECharacteristic::PROPERTY_WRITE
    );
    _pAlarmChar->addDescriptor(new BLE2902());
    _pAlarmChar->setCallbacks(new AlarmWriteCallbacks(this));
    uint8_t initAlarm = 0;
    _pAlarmChar->setValue(&initAlarm, 1);

    // 4. İlaç Onayı (NOTIFY) – buton basıldığında app'e bildirir
    _pMedicineChar = _pService->createCharacteristic(
      BLEUUID(BLE_CHAR_MEDICINE_UUID),
      BLECharacteristic::PROPERTY_NOTIFY
    );
    _pMedicineChar->addDescriptor(new BLE2902());

    // 5. Cihaz Bilgisi (READ)
    _pDeviceInfoChar = _pService->createCharacteristic(
      BLEUUID(BLE_CHAR_DEVICE_INFO_UUID),
      BLECharacteristic::PROPERTY_READ
    );
    String deviceInfo = String("{\"fw\":\"") + FIRMWARE_VERSION +
                        "\",\"id\":\"" + DEVICE_ID +
                        "\",\"bat_mah\":" + String(BATTERY_CAPACITY_MAH) + "}";
    _pDeviceInfoChar->setValue(deviceInfo.c_str());

    // Servisi başlat
    _pService->start();

    // Advertising başlat
    startAdvertising();

    DEBUG_PRINTLN("[BLE] ✅ BLE servisi hazır, yayın yapılıyor...");
  }

  /* ─── Advertising Başlat ───────────────────────────── */
  void startAdvertising() {
    BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(BLEUUID(BLE_SERVICE_UUID));
    pAdvertising->setScanResponse(true);
    pAdvertising->setMinPreferred(0x06);  // iPhone bağlantı sorunu için
    pAdvertising->setMinPreferred(0x12);
    BLEDevice::startAdvertising();
    isAdvertising = true;
    DEBUG_PRINTLN("[BLE] 📡 Advertising başlatıldı.");
  }

  /* ─── Pil Seviyesini Güncelle ──────────────────────── */
  void updateBatteryLevel(uint8_t percent) {
    if (!_pBatteryChar) return;
    _pBatteryChar->setValue(&percent, 1);
    if (isConnected) {
      _pBatteryChar->notify();
    }
  }

  /* ─── Şarj Durumunu Güncelle ───────────────────────── */
  void updateChargeState(uint8_t state) {
    if (!_pChargeChar) return;
    _pChargeChar->setValue(&state, 1);
    if (isConnected) {
      _pChargeChar->notify();
    }
  }

  /* ─── Alarm Durumunu Güncelle ──────────────────────── */
  void updateAlarmState(bool active) {
    if (!_pAlarmChar) return;
    uint8_t val = active ? 1 : 0;
    _pAlarmChar->setValue(&val, 1);
    if (isConnected) {
      _pAlarmChar->notify();
    }
  }

  /* ─── İlaç Onayını Bildir ──────────────────────────── */
  void notifyMedicineTaken() {
    if (!_pMedicineChar || !isConnected) return;

    // Timestamp gönder (basit Unix saniye)
    uint32_t timestamp = (uint32_t)millis();
    _pMedicineChar->setValue(timestamp);
    _pMedicineChar->notify();
    DEBUG_PRINTLN("[BLE] 💊 İlaç onay bildirimi gönderildi.");
  }

  /* ─── Alarm Callback Ayarla ────────────────────────── */
  void onAlarmCommand(BLEAlarmCallback callback) {
    _alarmCallback = callback;
  }

  /* ─── Bağlantı Kesildiğinde Yeniden Advertising ────── */
  void handleDisconnect() {
    isConnected = false;
    startAdvertising();
  }

  /* ─── BLE'yi Durdur (deep sleep öncesi) ────────────── */
  void stop() {
    BLEDevice::deinit(true);
    isAdvertising = false;
    isConnected = false;
    DEBUG_PRINTLN("[BLE] 🔌 BLE durduruldu.");
  }

private:
  BLEServer*         _pServer         = nullptr;
  BLEService*        _pService        = nullptr;
  BLECharacteristic* _pBatteryChar    = nullptr;
  BLECharacteristic* _pChargeChar     = nullptr;
  BLECharacteristic* _pAlarmChar      = nullptr;
  BLECharacteristic* _pMedicineChar   = nullptr;
  BLECharacteristic* _pDeviceInfoChar = nullptr;

  BLEAlarmCallback   _alarmCallback   = nullptr;

  /* ─── Server Bağlantı Callback'leri ────────────────── */
  class ServerCallbacks : public BLEServerCallbacks {
  public:
    ServerCallbacks(CareSyncBLE* parent) : _parent(parent) {}

    void onConnect(BLEServer* pServer) override {
      _parent->isConnected = true;
      DEBUG_PRINTLN("[BLE] 📱 Cihaz bağlandı!");
    }

    void onDisconnect(BLEServer* pServer) override {
      DEBUG_PRINTLN("[BLE] 📱 Cihaz bağlantısı koptu.");
      _parent->handleDisconnect();
    }

  private:
    CareSyncBLE* _parent;
  };

  /* ─── Alarm Yazma Callback'i ───────────────────────── */
  class AlarmWriteCallbacks : public BLECharacteristicCallbacks {
  public:
    AlarmWriteCallbacks(CareSyncBLE* parent) : _parent(parent) {}

    void onWrite(BLECharacteristic* pCharacteristic) override {
      uint8_t* data = pCharacteristic->getData();
      size_t len = pCharacteristic->getLength();

      if (len > 0 && _parent->_alarmCallback) {
        bool activate = (data[0] == 1);
        DEBUG_PRINTF("[BLE] 📝 Alarm komutu alındı: %s\n",
                     activate ? "AKTİF" : "DURDUR");
        _parent->_alarmCallback(activate);
      }
    }

  private:
    CareSyncBLE* _parent;
  };
};

#endif // BLE_SERVICE_H

/*
 * =========================================================
 *  CareSync – Firebase Senkronizasyon Modülü (Bileklik)
 *  
 *  85mAh pil ile güç tasarrufu stratejisi:
 *    - WiFi sadece senkronizasyon sırasında açılır
 *    - BLE sync sırasında DURDURULUR (bellek+radyo çakışması)
 *    - Firebase'e durum gönder → WiFi kapat → BLE tekrar aç
 * =========================================================
 */

#ifndef FIREBASE_SYNC_H
#define FIREBASE_SYNC_H

#include <Arduino.h>
#include <WiFi.h>
#include <time.h>
#include <Firebase_ESP_Client.h>
#include <addons/RTDBHelper.h>
#include <addons/TokenHelper.h>
#include "config.h"

class FirebaseSync {
public:
  bool isReady = false;
  bool wifiConnected = false;

  /* ─── Başlatma (sadece config, WiFi henüz bağlanmaz) ── */
  void begin() {
    _config.api_key = FIREBASE_API_KEY;
    _auth.user.email = FIREBASE_USER_EMAIL;
    _auth.user.password = FIREBASE_USER_PASSWORD;
    _config.token_status_callback = tokenStatusCallback;

    // SSL bellek boyutunu küçült (BLE ile beraber çalışabilsin)
    _fbdo.setBSSLBufferSize(2048, 1024);

    DEBUG_PRINTLN("[FIREBASE] Yapılandırma hazır.");
  }

  /* ─── WiFi Bağlan ──────────────────────────────────── */
  bool connectWiFi() {
    if (WiFi.status() == WL_CONNECTED) {
      wifiConnected = true;
      return true;
    }

    DEBUG_PRINT("[WIFI] Bağlanıyor");
    WiFi.mode(WIFI_STA);
    
    // Güç yetmezliği (Brownout) resetlerini önlemek için WiFi gücünü düşür (Varsayılan 20dBm -> 8.5dBm)
    WiFi.setTxPower(WIFI_POWER_MINUS_1dBm); // En düşük güç (-1dBm)
    
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    int retries = 0;
    while (WiFi.status() != WL_CONNECTED && retries < 20) {
      DEBUG_PRINT(".");
      delay(500);
      retries++;
    }

    if (WiFi.status() == WL_CONNECTED) {
      wifiConnected = true;
      DEBUG_PRINTLN("\n[WIFI] ✅ Bağlandı: " + WiFi.localIP().toString());

      // NTP saat senkronizasyonu (SSL sertifika doğrulaması için şart!)
      if (!_ntpSynced) {
        DEBUG_PRINTLN("[NTP] Saat senkronize ediliyor...");
        configTime(3 * 3600, 0, "pool.ntp.org", "time.nist.gov");
        
        // NTP yanıtını bekle (max 10 sn)
        int ntpRetry = 0;
        struct tm timeinfo;
        while (!getLocalTime(&timeinfo) && ntpRetry < 10) {
          delay(1000);
          ntpRetry++;
        }
        
        if (getLocalTime(&timeinfo)) {
          _ntpSynced = true;
          char buf[32];
          strftime(buf, sizeof(buf), "%H:%M:%S", &timeinfo);
          DEBUG_PRINTF("[NTP] ✅ Saat: %s\n", buf);
        } else {
          DEBUG_PRINTLN("[NTP] ❌ Saat alınamadı.");
        }
      }

      // Firebase başlat (ilk kez)
      if (!isReady) {
        Firebase.begin(&_config, &_auth);
        Firebase.reconnectWiFi(true);
        
        // Token hazır olmasını bekle (max 15 sn)
        DEBUG_PRINT("[FIREBASE] Token bekleniyor");
        int tokenRetry = 0;
        while (!Firebase.ready() && tokenRetry < 15) {
          DEBUG_PRINT(".");
          delay(1000);
          tokenRetry++;
        }
        
        if (Firebase.ready()) {
          isReady = true;
          DEBUG_PRINTLN("\n[FIREBASE] ✅ Firebase hazır.");
        } else {
          DEBUG_PRINTLN("\n[FIREBASE] ❌ Token alınamadı.");
          return false;
        }
      }

      return true;
    } else {
      wifiConnected = false;
      DEBUG_PRINTLN("\n[WIFI] ❌ Bağlanamadı.");
      return false;
    }
  }

  /* ─── WiFi Kapat (güç tasarrufu) ───────────────────── */
  void disconnectWiFi() {
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
    wifiConnected = false;
    DEBUG_PRINTLN("[WIFI] 💤 WiFi kapatıldı.");
  }

  /* ─── Cihaz Durumunu Firebase'e Gönder ─────────────── */
  bool syncStatus(uint8_t batteryPercent, float batteryVoltage, 
                  uint8_t chargeState, bool alarmActive, bool bleConnected) {
    
    if (!connectWiFi()) return false;
    if (!Firebase.ready()) {
      DEBUG_PRINTLN("[FIREBASE] Firebase hazır değil.");
      return false;
    }

    FirebaseJson content;
    content.set("fields/status/stringValue", "online");
    content.set("fields/type/stringValue", "bracelet");
    content.set("fields/batteryLevel/integerValue", (int)batteryPercent);
    content.set("fields/batteryVoltage/doubleValue", batteryVoltage);
    content.set("fields/chargeState/integerValue", (int)chargeState);
    content.set("fields/alarmActive/booleanValue", alarmActive);
    content.set("fields/bleConnected/booleanValue", bleConnected);
    content.set("fields/firmwareVersion/stringValue", FIRMWARE_VERSION);
    
    // Gerçek saat varsa ekle
    struct tm timeinfo;
    if (getLocalTime(&timeinfo)) {
      char timeBuf[32];
      strftime(timeBuf, sizeof(timeBuf), "%Y-%m-%d %H:%M:%S", &timeinfo);
      content.set("fields/lastSeen/stringValue", timeBuf);
    }

    String documentPath = "devices/" + String(DEVICE_ID);

    if (Firebase.Firestore.patchDocument(&_fbdo, FIREBASE_PROJECT_ID, "",
        documentPath.c_str(), content.raw(),
        "status,type,batteryLevel,batteryVoltage,chargeState,alarmActive,bleConnected,firmwareVersion,lastSeen")) {
      DEBUG_PRINTF("[FIREBASE] ✅ Durum güncellendi: Pil=%d%% Şarj=%d\n", 
                   batteryPercent, chargeState);
      return true;
    } else {
      DEBUG_PRINTLN("[FIREBASE] ❌ Hata: " + _fbdo.errorReason());
      return false;
    }
  }

  /* ─── Firebase'den Alarm Kontrolü ──────────────────── */
  uint8_t checkAlarmCommand() {
    if (!wifiConnected || !Firebase.ready()) return 0;

    String documentPath = "devices/" + String(DEVICE_ID);

    if (Firebase.Firestore.getDocument(&_fbdo, FIREBASE_PROJECT_ID, "",
        documentPath.c_str(), "")) {
      
      // FirebaseJson ile parse et (ArduinoJson gereksiz)
      FirebaseJson payload;
      payload.setJsonData(_fbdo.payload());
      
      FirebaseJsonData jsonData;
      
      bool triggerAlert = false;
      bool stopAlert = false;
      
      if (payload.get(jsonData, "fields/triggerAlert/booleanValue")) {
        triggerAlert = jsonData.boolValue;
      }
      if (payload.get(jsonData, "fields/stopAlert/booleanValue")) {
        stopAlert = jsonData.boolValue;
      }

      if (stopAlert) {
        clearField("stopAlert");
        return 2;
      }
      if (triggerAlert) {
        clearField("triggerAlert");
        return 1;
      }
    }
    return 0;
  }

  /* ─── İlaç Alındı Bilgisini Firebase'e Kaydet ──────── */
  bool confirmMedicineTaken() {
    if (!connectWiFi()) return false;
    if (!Firebase.ready()) return false;

    FirebaseJson content;
    
    struct tm timeinfo;
    if (getLocalTime(&timeinfo)) {
      char timeBuf[32];
      strftime(timeBuf, sizeof(timeBuf), "%Y-%m-%d %H:%M:%S", &timeinfo);
      content.set("fields/medicineTakenAt/stringValue", timeBuf);
    }
    content.set("fields/lastTaken/stringValue", String(millis()));

    String documentPath = "devices/" + String(DEVICE_ID);

    if (Firebase.Firestore.patchDocument(&_fbdo, FIREBASE_PROJECT_ID, "",
        documentPath.c_str(), content.raw(), "lastTaken,medicineTakenAt")) {
      DEBUG_PRINTLN("[FIREBASE] 💊 İlaç alındı kaydedildi.");
      return true;
    }
    return false;
  }

  /* ─── Senkronize Et ve WiFi Kapat ──────────────────── */
  bool syncAndDisconnect(uint8_t batteryPercent, float batteryVoltage,
                         uint8_t chargeState, bool alarmActive, bool bleConnected) {
    bool ok = syncStatus(batteryPercent, batteryVoltage, chargeState, alarmActive, bleConnected);
    
    uint8_t alarmCmd = checkAlarmCommand();
    if (alarmCmd == 1 && _onAlarmTrigger) _onAlarmTrigger();
    if (alarmCmd == 2 && _onAlarmStop) _onAlarmStop();

    disconnectWiFi();
    return ok;
  }

  /* ─── Callback'ler ─────────────────────────────────── */
  typedef void (*AlarmCallback)();
  void onAlarmTrigger(AlarmCallback cb) { _onAlarmTrigger = cb; }
  void onAlarmStop(AlarmCallback cb) { _onAlarmStop = cb; }

private:
  FirebaseData _fbdo;
  FirebaseAuth _auth;
  FirebaseConfig _config;
  bool _ntpSynced = false;
  
  AlarmCallback _onAlarmTrigger = nullptr;
  AlarmCallback _onAlarmStop = nullptr;

  void clearField(const char* fieldName) {
    if (!Firebase.ready()) return;
    FirebaseJson content;
    String field = String("fields/") + fieldName + "/booleanValue";
    content.set(field.c_str(), false);
    String documentPath = "devices/" + String(DEVICE_ID);
    Firebase.Firestore.patchDocument(&_fbdo, FIREBASE_PROJECT_ID, "",
        documentPath.c_str(), content.raw(), fieldName);
  }
};

#endif // FIREBASE_SYNC_H

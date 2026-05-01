/*
 * =========================================================
 *  CareSync – Güç Yönetimi Modülü
 *  
 *  550mAh 13400Q3 Li-Ion pil + TP4056 şarj modülü yönetimi:
 *  - ADC ile pil voltajı ölçümü ve yüzde hesaplama
 *  - TP4056 CHRG/STDBY pin okuma
 *  - USB güç algılama (pil bağlı değilken çalışma)
 *  - Düşük pil uyarısı
 *  - Deep Sleep modu ile güç tasarrufu
 * =========================================================
 */

#ifndef POWER_MANAGER_H
#define POWER_MANAGER_H

#include <Arduino.h>
#include "config.h"

/* ─── ESP32-S3 Deep Sleep için gerekli ─────────────────── */
#include <esp_sleep.h>
#include <driver/rtc_io.h>

class PowerManager {
public:
  uint8_t  batteryPercent  = 0;     // 0-100
  float    batteryVoltage  = 0.0;   // Volt cinsinden
  uint8_t  chargeState     = 0;     // 0=yok, 1=şarj oluyor, 2=tam
  bool     isLowBattery    = false;
  bool     isCritical      = false;
  bool     isUsbPowered    = false; // USB güçle mi çalışıyor (pil yok)?

  /* ─── Başlatma ──────────────────────────────────────── */
  void begin() {
    // TP4056 durum pinleri (aktif LOW, dahili pullup)
    pinMode(CHARGE_STATUS_PIN, INPUT_PULLUP);
    pinMode(CHARGE_DONE_PIN,   INPUT_PULLUP);

    // ADC çözünürlüğü: 12-bit (0-4095)
    analogReadResolution(12);
    // ADC zayıflama: 11dB → 0-3.3V aralığı
    analogSetAttenuation(ADC_11db);

    // USB güç algılama (pil bağlı mı kontrol et)
    detectPowerSource();

    // İlk okuma
    updateBattery();
    updateChargeState();

    DEBUG_PRINTLN("[GÜÇ] Güç yönetimi başlatıldı.");
    if (isUsbPowered) {
      DEBUG_PRINTLN("[GÜÇ] ⚡ USB güç algılandı – pil kontrolleri devre dışı.");
    } else {
      DEBUG_PRINTF("[GÜÇ] Pil: %.2fV (%d%%)\n", batteryVoltage, batteryPercent);
    }
  }

  /* ─── Pil Voltajını Oku ve Yüzde Hesapla ───────────── */
  void updateBattery() {
    // USB güçle çalışıyorsa gerçek ADC okumasına gerek yok
    if (isUsbPowered) {
      batteryVoltage = 4.20;  // Sanal tam pil
      batteryPercent = 100;
      isLowBattery = false;
      isCritical = false;
      return;
    }

    // Birden fazla okuma al ve ortalamasını hesapla (gürültü azaltma)
    uint32_t adcSum = 0;
    uint32_t adcMin = 4095;
    uint32_t adcMax = 0;
    const int SAMPLE_COUNT = 16;

    for (int i = 0; i < SAMPLE_COUNT; i++) {
      uint32_t val = analogRead(BATTERY_ADC_PIN);
      adcSum += val;
      if (val < adcMin) adcMin = val;
      if (val > adcMax) adcMax = val;
      delayMicroseconds(200);
    }

    uint32_t adcAvg = adcSum / SAMPLE_COUNT;

    // Floating ADC algılama: Gerçek pil kararlı okur, floating ADC dalgalanır
    // Min-Max farkı çok büyükse → pil bağlı değil
    uint32_t adcSpread = adcMax - adcMin;
    if (adcSpread > 200) {
      // ADC çok kararsız → pil bağlı değil, muhtemelen USB güç
      DEBUG_PRINTF("[GÜÇ] ⚠️ ADC kararsız (spread: %d) → Pil bağlı değil!\n", adcSpread);
      isUsbPowered = true;
      batteryVoltage = 4.20;
      batteryPercent = 100;
      isLowBattery = false;
      isCritical = false;
      return;
    }

    // ADC değerini voltaja çevir
    // ESP32-S3 ADC: 12-bit, 0-3.3V referans (11dB attenuation)
    float adcVoltage = (adcAvg / 4095.0) * 3.3;

    // Voltaj bölücü oranını uygula (gerçek pil voltajı)
    batteryVoltage = adcVoltage * BATTERY_DIVIDER_RATIO;

    // Voltajdan yüzdeye çevir (Li-Po discharge eğrisi - doğrusal yaklaşım)
    batteryPercent = voltageToPercent(batteryVoltage);

    // Düşük pil kontrolü
    isLowBattery = (batteryVoltage <= BATTERY_LOW_VOLTAGE);
    isCritical   = (batteryVoltage <= BATTERY_CRITICAL_VOLTAGE);

    DEBUG_PRINTF("[GÜÇ] ADC: %d → %.2fV → %d%%\n", adcAvg, batteryVoltage, batteryPercent);
  }

  /* ─── TP4056 Şarj Durumunu Oku ─────────────────────── */
  void updateChargeState() {
    bool chrg  = digitalRead(CHARGE_STATUS_PIN);  // LOW = şarj oluyor
    bool stdby = digitalRead(CHARGE_DONE_PIN);    // LOW = şarj tamamlandı

    // TP4056 durum tablosu:
    // CHRG=LOW,  STDBY=HIGH → Şarj oluyor
    // CHRG=HIGH, STDBY=LOW  → Şarj tamamlandı
    // CHRG=HIGH, STDBY=HIGH → Bağlı değil veya hata
    // CHRG=LOW,  STDBY=LOW  → Olmamalı (hata)

    if (!chrg && stdby) {
      chargeState = CHARGE_STATE_CHARGING;
      DEBUG_PRINTLN("[GÜÇ] 🔋 Şarj oluyor...");
    } else if (chrg && !stdby) {
      chargeState = CHARGE_STATE_COMPLETE;
      DEBUG_PRINTLN("[GÜÇ] ✅ Şarj tamamlandı.");
    } else {
      chargeState = CHARGE_STATE_NONE;
    }
  }

  /* ─── Tam Güncelleme ───────────────────────────────── */
  void update() {
    // Periyodik güç kaynağı kontrolü
    if (!isUsbPowered) {
      detectPowerSource();
    }
    updateBattery();
    updateChargeState();
  }

  /* ─── Deep Sleep'e Geç ─────────────────────────────── */
  void enterDeepSleep() {
    DEBUG_PRINTLN("[GÜÇ] ⚡ Deep Sleep moduna geçiliyor...");
    DEBUG_PRINTF("[GÜÇ] Uyanma: GPIO %d (buton basıldığında)\n", DEEP_SLEEP_WAKEUP_PIN);

    // Tüm çıkışları kapat
    digitalWrite(VIBRO_MOTOR_PIN, LOW);
    digitalWrite(STATUS_LED_PIN,  LOW);

    delay(100); // Serial tamponunun boşalması için

    // Buton ile uyanma ayarla (LOW seviyede uyan)
    esp_sleep_enable_ext0_wakeup((gpio_num_t)DEEP_SLEEP_WAKEUP_PIN, 0);

    // Deep Sleep'e gir
    esp_deep_sleep_start();

    // Bu satır asla çalışmaz (uyanınca setup()'tan başlar)
  }

  /* ─── Light Sleep (kısa süreli uyku) ───────────────── */
  void enterLightSleep(uint32_t sleepMs) {
    esp_sleep_enable_timer_wakeup(sleepMs * 1000ULL); // mikrosaniye
    esp_sleep_enable_ext0_wakeup((gpio_num_t)BUTTON_PIN, 0);
    esp_light_sleep_start();
  }

  /* ─── Kritik Pil Kontrolü ──────────────────────────── */
  bool shouldShutdown() {
    // USB güçle çalışıyorsa asla kapanma!
    if (isUsbPowered) return false;

    // Şarj oluyorsa asla kapanma
    if (chargeState == CHARGE_STATE_CHARGING) return false;
    
    // Voltaj çok düşükse pil bağlı değil, USB'den çalışıyor → kapanma
    // Eşik 2.5V: Gerçek Li-Po asla 3.0V altına düşmez,
    // 2.5V altı kesinlikle "pil bağlı değil" demek
    if (batteryVoltage < 2.5) {
      DEBUG_PRINTLN("[GÜÇ] Pil bağlı değil (USB güç). Deep sleep atlanıyor.");
      isUsbPowered = true;  // Otomatik USB moduna geç
      return false;
    }
    
    return isCritical;
  }

  /* ─── Tahmini Kalan Süre (dakika) ──────────────────── */
  uint16_t estimateRemainingMinutes() {
    // Basit tahmin: 550mAh pil (13400Q3), ortalama ~20mA tüketim (BLE+NRF aktif)
    // Deep sleep: ~0.01mA, aktif: ~35mA, ortalama: ~20mA
    float remainingMah = (batteryPercent / 100.0) * BATTERY_CAPACITY_MAH;
    float avgCurrentMa = 20.0; // tahmini ortalama akım
    float hours = remainingMah / avgCurrentMa;
    return (uint16_t)(hours * 60);
  }

private:
  /* ─── USB Güç Kaynağı Algılama ─────────────────────── */
  // TP4056 pinlerini ve ADC'yi kullanarak güç kaynağını belirle
  void detectPowerSource() {
    bool chrg  = digitalRead(CHARGE_STATUS_PIN);  // LOW = şarj oluyor
    bool stdby = digitalRead(CHARGE_DONE_PIN);    // LOW = şarj tamamlandı

    // TP4056 bağlıysa ve şarj oluyorsa veya tamamsa → USB bağlı
    if (!chrg || !stdby) {
      // Şarj oluyor veya tam → pil var + USB bağlı, normal çalış
      isUsbPowered = false;
      return;
    }

    // Her iki pin de HIGH → ya pil var USB yok, ya da pil yok USB var
    // ADC ile kontrol et: 3 ardışık okuma yap, kararlılığa bak
    uint32_t readings[3];
    for (int i = 0; i < 3; i++) {
      readings[i] = analogRead(BATTERY_ADC_PIN);
      delay(10);
    }

    // Okumalar arası fark
    uint32_t maxVal = max(readings[0], max(readings[1], readings[2]));
    uint32_t minVal = min(readings[0], min(readings[1], readings[2]));
    uint32_t spread = maxVal - minVal;

    // Ortalama voltaj
    float avgAdc = (readings[0] + readings[1] + readings[2]) / 3.0;
    float voltage = (avgAdc / 4095.0) * 3.3 * BATTERY_DIVIDER_RATIO;

    // Karar mantığı:
    // 1. ADC çok kararsız (spread > 150) → pil bağlı değil (floating)
    // 2. Voltaj < 2.5V → pil bağlı değil (gerçek Li-Po min 3.0V)
    // 3. ADC değeri çok düşük (< 100) → pin boşta
    if (spread > 150 || voltage < 2.5 || avgAdc < 100) {
      isUsbPowered = true;
      DEBUG_PRINTF("[GÜÇ] USB güç algılandı (ADC spread:%d, V:%.2f)\n", spread, voltage);
    } else {
      isUsbPowered = false;
    }
  }

  /* ─── Voltajdan Yüzdeye Çevrim ─────────────────────── */
  // Li-Po discharge eğrisi (parçalı doğrusal yaklaşım)
  uint8_t voltageToPercent(float voltage) {
    if (voltage >= BATTERY_FULL_VOLTAGE)     return 100;
    if (voltage <= BATTERY_EMPTY_VOLTAGE)    return 0;

    // Li-Po tipik discharge eğrisi (3 bölümlü)
    if (voltage >= 4.00) {
      // 4.00V - 4.20V arası: %80 - %100
      return map_float(voltage, 4.00, 4.20, 80, 100);
    } else if (voltage >= 3.50) {
      // 3.50V - 4.00V arası: %20 - %80 (doğrusal bölge)
      return map_float(voltage, 3.50, 4.00, 20, 80);
    } else {
      // 3.00V - 3.50V arası: %0 - %20 (hızlı düşüş)
      return map_float(voltage, 3.00, 3.50, 0, 20);
    }
  }

  // Float değerler için map fonksiyonu
  uint8_t map_float(float x, float in_min, float in_max, float out_min, float out_max) {
    float result = (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
    return constrain((uint8_t)result, (uint8_t)out_min, (uint8_t)out_max);
  }
};

#endif // POWER_MANAGER_H

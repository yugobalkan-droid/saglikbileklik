/*
 * =========================================================
 *  CareSync – Güç Yönetimi Modülü
 *  
 *  85mAh Li-Po pil + TP4056 şarj modülü yönetimi:
 *  - ADC ile pil voltajı ölçümü ve yüzde hesaplama
 *  - TP4056 CHRG/STDBY pin okuma
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

  /* ─── Başlatma ──────────────────────────────────────── */
  void begin() {
    // TP4056 durum pinleri (aktif LOW, dahili pullup)
    pinMode(CHARGE_STATUS_PIN, INPUT_PULLUP);
    pinMode(CHARGE_DONE_PIN,   INPUT_PULLUP);

    // ADC çözünürlüğü: 12-bit (0-4095)
    analogReadResolution(12);
    // ADC zayıflama: 11dB → 0-3.3V aralığı
    analogSetAttenuation(ADC_11db);

    // İlk okuma
    updateBattery();
    updateChargeState();

    DEBUG_PRINTLN("[GÜÇ] Güç yönetimi başlatıldı.");
    DEBUG_PRINTF("[GÜÇ] Pil: %.2fV (%d%%)\n", batteryVoltage, batteryPercent);
  }

  /* ─── Pil Voltajını Oku ve Yüzde Hesapla ───────────── */
  void updateBattery() {
    // Birden fazla okuma al ve ortalamasını hesapla (gürültü azaltma)
    uint32_t adcSum = 0;
    const int SAMPLE_COUNT = 16;

    for (int i = 0; i < SAMPLE_COUNT; i++) {
      adcSum += analogRead(BATTERY_ADC_PIN);
      delayMicroseconds(100);
    }

    uint32_t adcAvg = adcSum / SAMPLE_COUNT;

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
    // Şarj oluyorsa asla kapanma
    if (chargeState == CHARGE_STATE_CHARGING) return false;
    return isCritical;
  }

  /* ─── Tahmini Kalan Süre (dakika) ──────────────────── */
  uint16_t estimateRemainingMinutes() {
    // Basit tahmin: 85mAh pil, ortalama ~15mA tüketim (BLE+NRF aktif)
    // Deep sleep: ~0.01mA, aktif: ~30mA, ortalama: ~15mA
    float remainingMah = (batteryPercent / 100.0) * BATTERY_CAPACITY_MAH;
    float avgCurrentMa = 15.0; // tahmini ortalama akım
    float hours = remainingMah / avgCurrentMa;
    return (uint16_t)(hours * 60);
  }

private:
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

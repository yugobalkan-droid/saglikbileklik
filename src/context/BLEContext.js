/*
 * CareSync – BLE Context
 * 
 * Bileklik BLE bağlantı durumunu, pil seviyesini,
 * şarj durumunu ve alarm state'ini uygulama genelinde yönetir.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import * as BLEService from '../services/bleService';

const BLEContext = createContext(null);

export const useBLE = () => {
  const context = useContext(BLEContext);
  if (!context) throw new Error('useBLE must be used within BLEProvider');
  return context;
};

export function BLEProvider({ children }) {
  // Bileklik durumu
  const [bleConnected, setBleConnected]     = useState(false);
  const [bleScanning, setBleScanning]       = useState(false);
  const [batteryLevel, setBatteryLevel]     = useState(null);    // 0-100 veya null
  const [chargeState, setChargeState]       = useState(0);       // 0=yok, 1=şarj, 2=tam
  const [alarmActive, setAlarmActive]       = useState(false);
  const [bleStatus, setBleStatus]           = useState('idle');   // idle, scanning, connecting, connected, not_found, failed
  const [lastMedicineConfirm, setLastMedicineConfirm] = useState(null);

  const appState = useRef(AppState.currentState);

  // BLE callback'lerini ayarla
  useEffect(() => {
    BLEService.setCallbacks({
      onBattery: (level) => {
        setBatteryLevel(level);
      },
      onCharge: (state) => {
        setChargeState(state);
      },
      onAlarm: (active) => {
        setAlarmActive(active);
      },
      onMedicine: () => {
        setLastMedicineConfirm(new Date().toISOString());
      },
      onConnection: (connected) => {
        setBleConnected(connected);
        setBleStatus(connected ? 'connected' : 'idle');
      },
    });

    // Uygulama arka plana geçtiğinde BLE'yi temizle
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (appState.current === 'active' && nextState.match(/inactive|background/)) {
        // Arka plana geçerken bağlantıyı koru (disconnect yapma)
      }
      appState.current = nextState;
    });

    return () => {
      subscription.remove();
      BLEService.cleanup();
    };
  }, []);

  // Tara ve bağlan
  const connectWristband = useCallback(async () => {
    setBleScanning(true);
    setBleStatus('scanning');

    const success = await BLEService.scanAndConnect((status) => {
      setBleStatus(status);
    });

    setBleScanning(false);
    return success;
  }, []);

  // Bağlantıyı kes
  const disconnectWristband = useCallback(async () => {
    await BLEService.disconnectWristband();
    setBleConnected(false);
    setBatteryLevel(null);
    setChargeState(0);
    setAlarmActive(false);
    setBleStatus('idle');
  }, []);

  // Alarm gönder
  const triggerAlarm = useCallback(async () => {
    return await BLEService.sendAlarmCommand(true);
  }, []);

  // Alarm durdur
  const stopAlarm = useCallback(async () => {
    return await BLEService.sendAlarmCommand(false);
  }, []);

  // Şarj durumu metni
  const chargeStateText = chargeState === 1 ? 'Şarj oluyor' 
                         : chargeState === 2 ? 'Tam dolu' 
                         : 'Şarj yok';

  // Pil ikonu
  const batteryIcon = batteryLevel === null ? 'battery-dead-outline'
                    : batteryLevel >= 80 ? 'battery-full-outline'
                    : batteryLevel >= 50 ? 'battery-half-outline'
                    : batteryLevel >= 20 ? 'battery-half-outline'
                    : 'battery-dead-outline';

  // Pil rengi
  const batteryColor = batteryLevel === null ? '#9AA0A6'
                     : batteryLevel >= 50 ? '#34A853'
                     : batteryLevel >= 20 ? '#FBBC04'
                     : '#EA4335';

  const value = {
    // Durum
    bleConnected,
    bleScanning,
    bleStatus,
    batteryLevel,
    chargeState,
    chargeStateText,
    alarmActive,
    lastMedicineConfirm,
    
    // Hesaplanmış
    batteryIcon,
    batteryColor,
    
    // Aksiyonlar
    connectWristband,
    disconnectWristband,
    triggerAlarm,
    stopAlarm,
  };

  return (
    <BLEContext.Provider value={value}>
      {children}
    </BLEContext.Provider>
  );
}

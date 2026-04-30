import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { getPatientsByCaregiver, onPatientChanged } from '../services/patientService';
import { onDevicesChanged, formatDeviceStatus } from '../services/deviceService';
import { onTodayLogsChanged, getTodayStats, getNextMedication } from '../services/medicationLogService';
import { onAlertsChanged, getUnreadCount } from '../services/alertService';
import { onScheduleChanged, slotsToGrid } from '../services/scheduleService';

const PatientContext = createContext(null);

export const usePatient = () => {
  const context = useContext(PatientContext);
  if (!context) throw new Error('usePatient must be used within PatientProvider');
  return context;
};

export function PatientProvider({ children }) {
  const { user } = useAuth();
  const [patient, setPatient] = useState(null);
  const [patientId, setPatientId] = useState(null);
  const [deviceStatus, setDeviceStatus] = useState({ box: { status: 'offline' }, bracelet: { status: 'offline', batteryLevel: 0 } });
  const [todayLogs, setTodayLogs] = useState([]);
  const [todayStats, setTodayStats] = useState({ taken: 0, missed: 0, pending: 0, total: 0 });
  const [nextMedication, setNextMedication] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [scheduleGrid, setScheduleGrid] = useState({ 0: {}, 1: {}, 2: {} });
  const [loading, setLoading] = useState(true);
  
  const lastAlarmRef = React.useRef(null);
  const lastTakenRef = React.useRef(null);
  const lastBraceletTakenRef = React.useRef(null);
  const lastBraceletLowBatRef = React.useRef(false);

  // İlk yükleme: bakıcının hastasını bul
  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const loadPatient = async () => {
      try {
        const patients = await getPatientsByCaregiver(user.uid);
        if (patients.length > 0) {
          setPatient(patients[0]);
          setPatientId(patients[0].id);
        }
      } catch (error) {
        console.error('Error loading patient:', error);
      }
      setLoading(false);
    };

    loadPatient();
  }, [user]);

  // Gerçek zamanlı dinleyiciler
  useEffect(() => {
    if (!patientId) return;

    const unsubscribers = [];

    // Hasta verisi
    unsubscribers.push(
      onPatientChanged(patientId, (data) => setPatient(data))
    );

    // Cihaz durumu
    unsubscribers.push(
      onDevicesChanged(patientId, async (devices) => {
        setDeviceStatus(formatDeviceStatus(devices));

        // ── İLAÇ KUTUSU BİLDİRİMLERİ ──
        const box = devices.find(d => d.type === 'box');
        
        // Kutu: Otonom alarm (ilaç saati geldi, alınmadı)
        if (box && box.lastAutonomousAlarm) {
          if (lastAlarmRef.current !== box.lastAutonomousAlarm) {
            if (lastAlarmRef.current !== null) {
               try {
                 const { createAlert } = require('../services/alertService');
                 await createAlert({
                   patientId: patientId,
                   type: 'missed',
                   title: '⚠️ İlaç Alınmadı!',
                   message: `İlaç saati geldi ancak ilaç henüz alınmadı. Saat: ${box.lastAutonomousAlarm}`,
                   time: box.lastAutonomousAlarm,
                 });
               } catch(e) {
                 console.log("Alarm bildirimi oluşturulamadı", e);
               }
            }
            lastAlarmRef.current = box.lastAutonomousAlarm;
          }
        }

        // Kutu: İlaç alındı (buton basıldı)
        if (box && box.lastTaken) {
          if (lastTakenRef.current !== box.lastTaken) {
            if (lastTakenRef.current !== null) {
               try {
                 const { createAlert } = require('../services/alertService');
                 await createAlert({
                   patientId: patientId,
                   type: 'taken',
                   title: '✅ İlaç Alındı',
                   message: `Hasta ilacını kutudan aldı. Saat: ${box.lastTaken}`,
                   time: box.lastTaken,
                 });
               } catch(e) {
                 console.log("Alındı bildirimi oluşturulamadı", e);
               }
            }
            lastTakenRef.current = box.lastTaken;
          }
        }

        // ── BİLEKLİK BİLDİRİMLERİ ──
        const bracelet = devices.find(d => d.type === 'bracelet');
        
        // Bileklik: İlaç onayı (bileklik butonuna basıldı)
        if (bracelet && bracelet.lastTaken) {
          if (lastBraceletTakenRef.current !== bracelet.lastTaken) {
            if (lastBraceletTakenRef.current !== null) {
              try {
                const { createAlert } = require('../services/alertService');
                await createAlert({
                  patientId: patientId,
                  type: 'taken',
                  title: '✅ İlaç Onaylandı (Bileklik)',
                  message: `Hasta bileklikteki butona basarak ilacı aldığını onayladı.`,
                  time: bracelet.medicineTakenAt || bracelet.lastTaken,
                });
              } catch(e) {
                console.log("Bileklik onay bildirimi oluşturulamadı", e);
              }
            }
            lastBraceletTakenRef.current = bracelet.lastTaken;
          }
        }

        // Bileklik: Düşük pil uyarısı (<%20)
        if (bracelet && bracelet.batteryLevel !== undefined) {
          const level = bracelet.batteryLevel;
          if (level > 0 && level <= 20 && !lastBraceletLowBatRef.current) {
            lastBraceletLowBatRef.current = true;
            try {
              const { createAlert } = require('../services/alertService');
              await createAlert({
                patientId: patientId,
                type: 'device',
                title: '🔋 Bileklik Pili Düşük',
                message: `Bileklik pil seviyesi %${level}. Lütfen şarj edin.`,
              });
            } catch(e) {
              console.log("Pil bildirimi oluşturulamadı", e);
            }
          } else if (level > 20) {
            lastBraceletLowBatRef.current = false;
          }
        }
      })
    );

    // Bugünün ilaç logları
    try {
      unsubscribers.push(
        onTodayLogsChanged(patientId, (logs) => {
          setTodayLogs(logs);
          setTodayStats(getTodayStats(logs));
          setNextMedication(getNextMedication(logs));
        })
      );
    } catch (error) {
      console.warn('İlaç logları dinleyicisi başlatılamadı (Firestore index gerekebilir):', error);
    }

    // Bildirimler
    try {
      unsubscribers.push(
        onAlertsChanged(patientId, (alertData) => {
          setAlerts(alertData);
          setUnreadCount(getUnreadCount(alertData));
        })
      );
    } catch (error) {
      console.warn('Bildirim dinleyicisi başlatılamadı (Firestore index gerekebilir):', error);
    }

    // Haftalık program
    unsubscribers.push(
      onScheduleChanged(patientId, (slots) => {
        setScheduleGrid(slotsToGrid(slots));
      })
    );

    return () => unsubscribers.forEach((unsub) => {
      if (typeof unsub === 'function') unsub();
    });
  }, [patientId]);

  const value = {
    patient,
    patientId,
    deviceStatus,
    todayLogs,
    todayStats,
    nextMedication,
    alerts,
    unreadCount,
    scheduleGrid,
    loading,
    setPatientId,
  };

  return (
    <PatientContext.Provider value={value}>
      {children}
    </PatientContext.Provider>
  );
}

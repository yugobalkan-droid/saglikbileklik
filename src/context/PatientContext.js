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

        // Otonom alarm kontrolü
        const box = devices.find(d => d.type === 'box');
        if (box && box.lastAutonomousAlarm) {
          if (lastAlarmRef.current !== box.lastAutonomousAlarm) {
            // İlk yükleme değilse ve alarm zamanı değiştiyse uygulamada bildirim oluştur
            if (lastAlarmRef.current !== null) {
               try {
                 const { createAlert } = require('../services/alertService');
                 await createAlert({
                   patientId: patientId,
                   type: 'missed', // Ekranda AlertOverlay çıkması için 'missed' tipinde
                   title: 'ESP32 Alarmı!',
                   message: `İlaç kutusunda ${box.lastAutonomousAlarm} alarmı tetiklendi.`,
                   time: box.lastAutonomousAlarm,
                 });
               } catch(e) {
                 console.log("Otonom bildirim oluşturulamadı", e);
               }
            }
            lastAlarmRef.current = box.lastAutonomousAlarm;
          }
        }

        // İlaç Alındı (Buton) kontrolü
        if (box && box.medicineTakenTime) {
          if (lastTakenRef.current !== box.medicineTakenTime) {
            if (lastTakenRef.current !== null) {
               try {
                 const { createAlert } = require('../services/alertService');
                 await createAlert({
                   patientId: patientId,
                   type: 'taken', // Alındı bildirimi
                   title: 'İlaç Alındı',
                   message: `Kutudaki fiziksel butona basıldı! Saat: ${box.medicineTakenTime}`,
                   time: box.medicineTakenTime,
                 });
               } catch(e) {
                 console.log("Alındı bildirimi oluşturulamadı", e);
               }
            }
            lastTakenRef.current = box.medicineTakenTime;
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

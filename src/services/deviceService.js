import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../config/firebase';

const COLLECTION = 'devices';

// Hastanın cihazlarını getir
export const getDevices = async (patientId) => {
  const q = query(
    collection(db, COLLECTION),
    where('patientId', '==', patientId)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
};

// Cihaz durumlarını gerçek zamanlı dinle
export const onDevicesChanged = (patientId, callback) => {
  const q = query(
    collection(db, COLLECTION),
    where('patientId', '==', patientId)
  );

  return onSnapshot(q, async (snapshot) => {
    let devices = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    
    // Eğer hastaya ait kutu bulunamadıysa, ESP32'nin varsayılan ID'sini ('esp32_medicine_box_01') bu hastaya bağla
    if (!devices.find(d => d.type === 'box')) {
      try {
        const defaultBoxRef = doc(db, COLLECTION, 'esp32_medicine_box_01');
        await setDoc(defaultBoxRef, {
          patientId: patientId,
          type: 'box',
          // status alanını ezmiyoruz; ESP32 açıksa zaten 'online' yapmıştır
          createdAt: serverTimestamp()
        }, { merge: true });
        console.log("esp32_medicine_box_01 cihaza patientId eklendi.");
        
        // Eşleşme sağlandıktan hemen sonra mevcut programı ESP32'ye gönder
        const { syncDeviceSchedule } = require('./scheduleService');
        await syncDeviceSchedule(patientId);
      } catch (error) {
        console.log("Cihaz bağlanırken hata:", error);
      }
    }

    // Eğer hastaya ait bileklik bulunamadıysa, ESP32 bilekliğin varsayılan ID'sini bu hastaya bağla
    if (!devices.find(d => d.type === 'bracelet')) {
      try {
        const defaultBraceletRef = doc(db, COLLECTION, 'esp32_wristband_01');
        await setDoc(defaultBraceletRef, {
          patientId: patientId,
          type: 'bracelet',
          createdAt: serverTimestamp()
        }, { merge: true });
        console.log("esp32_wristband_01 bileklik cihazına patientId eklendi.");
      } catch (error) {
        console.log("Bileklik bağlanırken hata:", error);
      }
    }
    
    callback(devices);
  });
};

// Cihaz durumunu güncelle (Arduino/ESP32 tarafından çağrılır)
export const updateDeviceStatus = async (deviceId, data) => {
  const docRef = doc(db, COLLECTION, deviceId);
  await setDoc(docRef, {
    ...data,
    lastSeen: serverTimestamp(),
  }, { merge: true });
};

// Cihazın alarmını manuel olarak tekrar çaldırmak için triggerAlert bayrağını true yap
export const triggerDeviceAlarm = async (patientId) => {
  const q = query(
    collection(db, COLLECTION),
    where('patientId', '==', patientId)
  );
  const snapshot = await getDocs(q);
  
  if (!snapshot.empty) {
    const batch = writeBatch(db);
    snapshot.docs.forEach((deviceDoc) => {
      const docRef = doc(db, COLLECTION, deviceDoc.id);
      if (deviceDoc.data().type === 'box') {
        batch.update(docRef, { triggerAlert: true, stopAlert: false, lastResend: serverTimestamp() });
      } else if (deviceDoc.data().type === 'bracelet') {
        batch.update(docRef, { triggerAlert: true, stopAlert: false });
      }
    });
    await batch.commit();
  }
};

// Cihazın alarmını durdurmak için
export const stopDeviceAlarm = async (patientId) => {
  const q = query(
    collection(db, COLLECTION),
    where('patientId', '==', patientId)
  );
  const snapshot = await getDocs(q);
  
  if (!snapshot.empty) {
    const batch = writeBatch(db);
    snapshot.docs.forEach((deviceDoc) => {
      const docRef = doc(db, COLLECTION, deviceDoc.id);
      if (deviceDoc.data().type === 'box') {
        batch.update(docRef, { stopAlert: true, triggerAlert: false });
      } else if (deviceDoc.data().type === 'bracelet') {
        batch.update(docRef, { stopAlert: true, triggerAlert: false });
      }
    });
    await batch.commit();
  }
};

// Cihaz oluştur veya güncelle
export const registerDevice = async (deviceId, data) => {
  const docRef = doc(db, COLLECTION, deviceId);
  await setDoc(docRef, {
    patientId: data.patientId,
    type: data.type, // 'box' | 'bracelet'
    status: 'online',
    batteryLevel: data.batteryLevel || 100,
    signalStrength: data.signalStrength || 'strong',
    firmwareVersion: data.firmwareVersion || '1.0',
    lastSeen: serverTimestamp(),
    createdAt: serverTimestamp(),
  }, { merge: true });
};

// Cihaz durumunu formatlı getir (ekran için)
export const formatDeviceStatus = (devices) => {
  const box = devices.find((d) => d.type === 'box');
  const bracelet = devices.find((d) => d.type === 'bracelet');

  return {
    box: box ? {
      status: box.status || 'offline',
      signalStrength: box.signalStrength || 'unknown',
    } : { status: 'offline', signalStrength: 'unknown' },
    bracelet: bracelet ? {
      status: bracelet.status || 'offline',
      batteryLevel: bracelet.batteryLevel || 0,
    } : { status: 'offline', batteryLevel: 0 },
  };
};

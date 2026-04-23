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
          status: 'offline', // ESP32 açılınca online yapacak
          createdAt: serverTimestamp()
        }, { merge: true });
        console.log("esp32_medicine_box_01 cihaza patientId eklendi.");
      } catch (error) {
        console.log("Cihaz bağlanırken hata:", error);
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

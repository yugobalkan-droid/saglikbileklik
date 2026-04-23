import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';

// Haftalık programı getir (21 bölme)
export const getWeeklySchedule = async (patientId) => {
  const slotsRef = collection(db, 'schedules', patientId, 'slots');
  const snapshot = await getDocs(slotsRef);
  const slots = {};

  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    const key = `${data.period}-${data.day}`;
    slots[key] = { id: doc.id, ...data };
  });

  return slots;
};

// Haftalık programı gerçek zamanlı dinle
export const onScheduleChanged = (patientId, callback) => {
  const slotsRef = collection(db, 'schedules', patientId, 'slots');
  return onSnapshot(slotsRef, (snapshot) => {
    const slots = {};
    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const key = `${data.period}-${data.day}`;
      slots[key] = { id: doc.id, ...data };
    });
    callback(slots);
  });
};

// ESP32 cihazı için günlük program JSON'unu hazırla ve cihaza gönder
export const syncDeviceSchedule = async (patientId) => {
  try {
    // 1. Tüm slotları al
    const slotsRef = collection(db, 'schedules', patientId, 'slots');
    const snapshot = await getDocs(slotsRef);
    
    // 2. Gün bazlı (0=Pzt ... 6=Paz) array oluştur
    const scheduleData = {
      "0": [], "1": [], "2": [], "3": [], "4": [], "5": [], "6": []
    };

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (data.enabled && data.time && data.day !== undefined) {
        if (!scheduleData[data.day].includes(data.time)) {
          scheduleData[data.day].push(data.time);
        }
      }
    });

    const scheduleJSON = JSON.stringify(scheduleData);

    // 3. Doğrudan ESP32 cihazının sabit ID'sine yaz (Farklı hasta ID'si çakışmasını kökten çözmek için)
    const deviceId = 'esp32_medicine_box_01';
    const deviceRef = doc(db, 'devices', deviceId);
    
    await setDoc(deviceRef, {
      scheduleJSON: scheduleJSON,
      updatedAt: serverTimestamp(),
      patientId: patientId, // Cihazın hastaya ait olduğundan kesinlikle emin ol
      type: 'box'
    }, { merge: true });
    
    console.log(`[Sync] Device ${deviceId} scheduleJSON güncellendi: `, scheduleJSON);
    
  } catch (error) {
    console.error("Cihaz senkronizasyon hatası:", error);
  }
};

// Bölme ekle/güncelle
export const upsertSlot = async (patientId, slotData) => {
  const slotId = `slot_${slotData.period}_${slotData.day}`;
  const slotRef = doc(db, 'schedules', patientId, 'slots', slotId);

  await setDoc(slotRef, {
    compartment: slotData.period * 7 + slotData.day + 1,
    day: slotData.day,
    period: slotData.period,
    medicationName: slotData.medicationName,
    dosage: slotData.dosage || '',
    time: slotData.time,
    enabled: true,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  // ESP32 programını güncelle
  await syncDeviceSchedule(patientId);

  return slotId;
};

// Bölme sil
export const deleteSlot = async (patientId, period, day) => {
  const slotId = `slot_${period}_${day}`;
  const slotRef = doc(db, 'schedules', patientId, 'slots', slotId);
  await deleteDoc(slotRef);

  // ESP32 programını güncelle
  await syncDeviceSchedule(patientId);
};

// Grid formatında dönüştür (ekran için)
export const slotsToGrid = (slots) => {
  const grid = {
    0: {}, // Sabah
    1: {}, // Öğle
    2: {}, // Akşam
  };

  Object.values(slots).forEach((slot) => {
    if (slot.enabled) {
      grid[slot.period][slot.day] = {
        name: slot.medicationName,
        time: slot.time,
        dosage: slot.dosage,
        id: slot.id,
      };
    }
  });

  return grid;
};

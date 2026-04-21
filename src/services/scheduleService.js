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

  return slotId;
};

// Bölme sil
export const deleteSlot = async (patientId, period, day) => {
  const slotId = `slot_${period}_${day}`;
  const slotRef = doc(db, 'schedules', patientId, 'slots', slotId);
  await deleteDoc(slotRef);
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

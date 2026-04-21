// ============================================
// CareSync — Firestore Demo Veri Oluşturucu
// ============================================
// Bu dosya, uygulamanın test edilmesi için
// Firestore'a demo veriler ekler.
// Dashboard'da veya Settings'de "Demo Veri Yükle"
// butonuna basıldığında çağrılır.
// ============================================

import { db } from '../config/firebase';
import {
  doc,
  setDoc,
  addDoc,
  collection,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';

export const seedDemoData = async (userId) => {
  const patientId = `patient_${userId}`;

  // 1. Hasta oluştur
  await setDoc(doc(db, 'patients', patientId), {
    name: 'Ahmet Yılmaz',
    age: 78,
    diagnosis: 'Alzheimer Tip 2',
    notes: 'Günde 3 öğün ilaç alması gerekiyor.',
    caregiverId: userId,
    createdAt: serverTimestamp(),
  });

  // 2. Acil durum kişileri
  await addDoc(collection(db, 'patients', patientId, 'emergencyContacts'), {
    name: 'Ayşe Yılmaz',
    phone: '+90 532 123 4567',
    relation: 'Kızı',
    createdAt: serverTimestamp(),
  });

  await addDoc(collection(db, 'patients', patientId, 'emergencyContacts'), {
    name: 'Dr. Mehmet Kaya',
    phone: '+90 212 987 6543',
    relation: 'Doktor',
    createdAt: serverTimestamp(),
  });

  // 3. Cihazlar
  await setDoc(doc(db, 'devices', `box_${patientId}`), {
    patientId,
    type: 'box',
    status: 'online',
    signalStrength: 'strong',
    firmwareVersion: '1.2',
    lastSeen: serverTimestamp(),
    createdAt: serverTimestamp(),
  });

  await setDoc(doc(db, 'devices', `bracelet_${patientId}`), {
    patientId,
    type: 'bracelet',
    status: 'online',
    batteryLevel: 85,
    firmwareVersion: '2.0',
    lastSeen: serverTimestamp(),
    createdAt: serverTimestamp(),
  });

  // 4. Haftalık program (21 bölme)
  const scheduleData = [
    // Sabah (period 0) — Pazartesi-Cuma
    { period: 0, day: 0, medicationName: 'Donepezil 10mg', dosage: '1 tablet', time: '08:00' },
    { period: 0, day: 1, medicationName: 'Donepezil 10mg', dosage: '1 tablet', time: '08:00' },
    { period: 0, day: 2, medicationName: 'Donepezil 10mg', dosage: '1 tablet', time: '08:00' },
    { period: 0, day: 3, medicationName: 'Donepezil 10mg', dosage: '1 tablet', time: '08:00' },
    { period: 0, day: 4, medicationName: 'Donepezil 10mg', dosage: '1 tablet', time: '08:00' },
    // Öğle (period 1) — Pazartesi, Çarşamba, Cuma
    { period: 1, day: 0, medicationName: 'Memantine 20mg', dosage: '1 tablet', time: '14:00' },
    { period: 1, day: 2, medicationName: 'Memantine 20mg', dosage: '1 tablet', time: '14:00' },
    { period: 1, day: 4, medicationName: 'Memantine 20mg', dosage: '1 tablet', time: '14:00' },
    // Akşam (period 2) — Her gün
    { period: 2, day: 0, medicationName: 'Rivastigmine 6mg', dosage: '1 kapsül', time: '20:00' },
    { period: 2, day: 1, medicationName: 'Rivastigmine 6mg', dosage: '1 kapsül', time: '20:00' },
    { period: 2, day: 2, medicationName: 'Rivastigmine 6mg', dosage: '1 kapsül', time: '20:00' },
    { period: 2, day: 3, medicationName: 'Rivastigmine 6mg', dosage: '1 kapsül', time: '20:00' },
    { period: 2, day: 4, medicationName: 'Rivastigmine 6mg', dosage: '1 kapsül', time: '20:00' },
    { period: 2, day: 5, medicationName: 'Rivastigmine 6mg', dosage: '1 kapsül', time: '20:00' },
    { period: 2, day: 6, medicationName: 'Rivastigmine 6mg', dosage: '1 kapsül', time: '20:00' },
  ];

  for (const slot of scheduleData) {
    const slotId = `slot_${slot.period}_${slot.day}`;
    await setDoc(doc(db, 'schedules', patientId, 'slots', slotId), {
      compartment: slot.period * 7 + slot.day + 1,
      day: slot.day,
      period: slot.period,
      medicationName: slot.medicationName,
      dosage: slot.dosage,
      time: slot.time,
      enabled: true,
      updatedAt: serverTimestamp(),
    });
  }

  // 5. Bugünün ilaç logları
  const today = new Date();
  const periods = [
    { hour: 8, period: 0, name: 'Donepezil 10mg', compartment: 1 },
    { hour: 14, period: 1, name: 'Memantine 20mg', compartment: 8 },
    { hour: 20, period: 2, name: 'Rivastigmine 6mg', compartment: 15 },
  ];

  for (const p of periods) {
    const scheduledTime = new Date(today);
    scheduledTime.setHours(p.hour, 0, 0, 0);

    const now = new Date();
    let status = 'pending';
    if (scheduledTime.getTime() + 30 * 60000 < now.getTime()) {
      status = p.period === 0 ? 'taken' : 'missed';
    } else if (scheduledTime < now) {
      status = p.period === 0 ? 'taken' : 'pending';
    }

    await addDoc(collection(db, 'medicationLogs'), {
      patientId,
      compartment: p.compartment,
      medicationName: p.name,
      period: p.period,
      scheduledTime: Timestamp.fromDate(scheduledTime),
      status,
      ...(status === 'taken' ? { takenAt: Timestamp.fromDate(new Date(scheduledTime.getTime() + 5 * 60000)) } : {}),
      createdAt: serverTimestamp(),
    });
  }

  // 6. Bildirimler
  const alertsData = [
    {
      type: 'taken',
      title: 'İlaç Alındı',
      message: 'Sabah ilacı başarıyla alındı.',
      medication: 'Donepezil 10mg',
      compartment: 'Bölme 1',
      time: '08:00',
    },
    {
      type: 'device',
      title: 'Bileklik Bağlandı',
      message: 'Titreşimli bileklik başarıyla bağlandı.',
    },
    {
      type: 'reminder',
      title: 'Kutu Yeniden Doldurma',
      message: 'Haftalık ilaç kutusunun yeniden doldurulma zamanı yaklaşıyor.',
    },
  ];

  for (const alert of alertsData) {
    await addDoc(collection(db, 'alerts'), {
      patientId,
      ...alert,
      isRead: false,
      isResolved: false,
      createdAt: serverTimestamp(),
    });
  }

  console.log('✅ Demo veriler başarıyla yüklendi!');
  return patientId;
};

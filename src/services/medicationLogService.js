import {
  collection,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';

const COLLECTION = 'medicationLogs';

// Bugünün ilaç loglarını getir
export const getTodayLogs = async (patientId) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const q = query(
    collection(db, COLLECTION),
    where('patientId', '==', patientId),
    where('scheduledTime', '>=', Timestamp.fromDate(today)),
    where('scheduledTime', '<', Timestamp.fromDate(tomorrow)),
    orderBy('scheduledTime', 'asc')
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
};

// Bugünün loglarını gerçek zamanlı dinle
export const onTodayLogsChanged = (patientId, callback) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const q = query(
    collection(db, COLLECTION),
    where('patientId', '==', patientId),
    where('scheduledTime', '>=', Timestamp.fromDate(today)),
    where('scheduledTime', '<', Timestamp.fromDate(tomorrow)),
    orderBy('scheduledTime', 'asc')
  );

  return onSnapshot(q, (snapshot) => {
    const logs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    callback(logs);
  });
};

// Yeni ilaç logu oluştur (program tetiklenmesinde)
export const createMedicationLog = async (data) => {
  const docRef = await addDoc(collection(db, COLLECTION), {
    patientId: data.patientId,
    compartment: data.compartment,
    medicationName: data.medicationName,
    scheduledTime: Timestamp.fromDate(data.scheduledTime),
    period: data.period, // 0=sabah, 1=öğle, 2=akşam
    status: 'pending',
    createdAt: serverTimestamp(),
  });
  return docRef.id;
};

// İlaç alındı olarak işaretle (kapak açıldığında - Arduino tarafından çağrılır)
export const markAsTaken = async (logId) => {
  const docRef = doc(db, COLLECTION, logId);
  await updateDoc(docRef, {
    status: 'taken',
    takenAt: serverTimestamp(),
  });
};

// İlaç kaçırıldı olarak işaretle (30 dk sonra otomatik)
export const markAsMissed = async (logId) => {
  const docRef = doc(db, COLLECTION, logId);
  await updateDoc(docRef, {
    status: 'missed',
    missedAt: serverTimestamp(),
  });
};

// Sıradaki ilacı getir
export const getNextMedication = (logs) => {
  const now = new Date();
  return logs.find((log) => {
    const scheduledTime = log.scheduledTime?.toDate?.() || new Date(log.scheduledTime);
    return log.status === 'pending' && scheduledTime > now;
  });
};

// Bugünün istatistikleri
export const getTodayStats = (logs) => {
  const taken = logs.filter((l) => l.status === 'taken').length;
  const missed = logs.filter((l) => l.status === 'missed').length;
  const pending = logs.filter((l) => l.status === 'pending').length;
  const total = logs.length;

  return { taken, missed, pending, total };
};

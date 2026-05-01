import {
  collection,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  deleteDoc,
} from 'firebase/firestore';
import { db } from '../config/firebase';

const COLLECTION = 'alerts';

// Bildirimleri getir
export const getAlerts = async (patientId, maxCount = 20) => {
  const q = query(
    collection(db, COLLECTION),
    where('patientId', '==', patientId),
    orderBy('createdAt', 'desc'),
    limit(maxCount)
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
};

// Bildirimleri gerçek zamanlı dinle
export const onAlertsChanged = (patientId, callback, maxCount = 20) => {
  const q = query(
    collection(db, COLLECTION),
    where('patientId', '==', patientId),
    orderBy('createdAt', 'desc'),
    limit(maxCount)
  );

  return onSnapshot(q, (snapshot) => {
    const alerts = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    callback(alerts);
  });
};

// Yeni bildirim oluştur
export const createAlert = async (data) => {
  const docRef = await addDoc(collection(db, COLLECTION), {
    patientId: data.patientId,
    type: data.type, // 'missed' | 'device' | 'reminder' | 'taken'
    title: data.title,
    message: data.message,
    medication: data.medication || null,
    compartment: data.compartment || null,
    time: data.time || null,
    isRead: false,
    isResolved: false,
    createdAt: serverTimestamp(),
  });
  return docRef.id;
};

// Bildirim okundu olarak işaretle
export const markAsRead = async (alertId) => {
  const docRef = doc(db, COLLECTION, alertId);
  await updateDoc(docRef, { isRead: true });
};

// Bildirim çözüldü olarak işaretle
export const resolveAlert = async (alertId) => {
  const docRef = doc(db, COLLECTION, alertId);
  await updateDoc(docRef, {
    isResolved: true,
    resolvedAt: serverTimestamp(),
  });
};

// Tüm bildirimleri okundu yap
export const markAllAsRead = async (patientId) => {
  const q = query(
    collection(db, COLLECTION),
    where('patientId', '==', patientId),
    where('isRead', '==', false)
  );

  const snapshot = await getDocs(q);
  const updatePromises = snapshot.docs.map((docSnap) =>
    updateDoc(doc(db, COLLECTION, docSnap.id), { isRead: true })
  );

  await Promise.all(updatePromises);
};

// Okunmamış bildirim sayısı
export const getUnreadCount = (alerts) => {
  return alerts.filter((a) => !a.isRead).length;
};

// Tüm bildirimleri tamamen sil (Temizlik için)
export const deleteAllAlerts = async (patientId) => {
  const q = query(
    collection(db, COLLECTION),
    where('patientId', '==', patientId)
  );

  const snapshot = await getDocs(q);
  const deletePromises = snapshot.docs.map((docSnap) =>
    deleteDoc(doc(db, COLLECTION, docSnap.id))
  );

  await Promise.all(deletePromises);
};

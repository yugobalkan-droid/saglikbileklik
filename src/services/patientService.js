import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  addDoc,
} from 'firebase/firestore';
import { db } from '../config/firebase';

const COLLECTION = 'patients';

// Bakıcının hastalarını getir
export const getPatientsByCaregiver = async (caregiverId) => {
  const q = query(collection(db, COLLECTION), where('caregiverId', '==', caregiverId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
};

// Hasta detayını getir
export const getPatient = async (patientId) => {
  const docRef = doc(db, COLLECTION, patientId);
  const docSnap = await getDoc(docRef);
  return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null;
};

// Hasta oluştur
export const createPatient = async (data) => {
  const docRef = await addDoc(collection(db, COLLECTION), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return docRef.id;
};

// Hasta güncelle
export const updatePatient = async (patientId, data) => {
  const docRef = doc(db, COLLECTION, patientId);
  await updateDoc(docRef, {
    ...data,
    updatedAt: serverTimestamp(),
  });
};

// Hasta verilerini gerçek zamanlı dinle
export const onPatientChanged = (patientId, callback) => {
  const docRef = doc(db, COLLECTION, patientId);
  return onSnapshot(docRef, (docSnap) => {
    if (docSnap.exists()) {
      callback({ id: docSnap.id, ...docSnap.data() });
    }
  });
};

// Acil durum kişilerini getir
export const getEmergencyContacts = async (patientId) => {
  const q = collection(db, COLLECTION, patientId, 'emergencyContacts');
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
};

// Acil durum kişisi ekle
export const addEmergencyContact = async (patientId, contactData) => {
  await addDoc(collection(db, COLLECTION, patientId, 'emergencyContacts'), {
    ...contactData,
    createdAt: serverTimestamp(),
  });
};

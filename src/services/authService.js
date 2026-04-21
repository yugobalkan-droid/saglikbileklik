import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updateProfile,
  sendEmailVerification,
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../config/firebase';

// Giriş yap
export const signIn = async (email, password) => {
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  return userCredential.user;
};

// Kayıt ol
export const signUp = async (email, password, displayName) => {
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;

  // Profil güncelle
  await updateProfile(user, { displayName });

  // Onay e-maili gönder
  try {
    await sendEmailVerification(user);
  } catch (error) {
    console.error("E-mail onay gönderme hatası:", error);
  }

  // Firestore'a kullanıcı belgesi oluştur
  await setDoc(doc(db, 'users', user.uid), {
    email,
    displayName,
    role: 'caregiver',
    createdAt: serverTimestamp(),
  });

  return user;
};

// Çıkış yap
export const signOut = async () => {
  await firebaseSignOut(auth);
};

// Mevcut kullanıcıyı al
export const getCurrentUser = () => auth.currentUser;

// Auth durumu dinleyici
export const onAuthChanged = (callback) => {
  return onAuthStateChanged(auth, callback);
};

// Kullanıcı profilini al
export const getUserProfile = async (userId) => {
  const docRef = doc(db, 'users', userId);
  const docSnap = await getDoc(docRef);
  return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null;
};

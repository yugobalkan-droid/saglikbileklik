// ============================================
// CareSync Firebase Configuration
// ============================================
// ÖNEMLİ: Aşağıdaki değerleri Firebase Console'dan
// aldığınız gerçek config bilgileriyle değiştirin!
//
// Adımlar:
// 1. console.firebase.google.com → Proje Oluştur
// 2. Proje Ayarları → Web uygulaması ekle
// 3. Config bilgilerini buraya yapıştırın
// ============================================

import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyDHII3X9MFkX5_HF6W5NtyosNyHFef9uDs",
  authDomain: "saglikbileklik-356ed.firebaseapp.com",
  projectId: "saglikbileklik-356ed",
  storageBucket: "saglikbileklik-356ed.firebasestorage.app",
  messagingSenderId: "827280543386",
  appId: "1:827280543386:web:e660d50a59aaf40c5b1923",
  measurementId: "G-0KSCV0X3VL"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
export const db = getFirestore(app);
export const auth = getAuth(app);

export default app;

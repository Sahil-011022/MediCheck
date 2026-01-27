import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAiXinjWab1byDiTIBiMC5Gcj7p8efJnXQ",
  authDomain: "medicheck-6fb91.firebaseapp.com",
  projectId: "medicheck-6fb91",
  storageBucket: "medicheck-6fb91.firebasestorage.app",
  messagingSenderId: "461419071986",
  appId: "1:461419071986:web:b062eace1f4ca132c8036b"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
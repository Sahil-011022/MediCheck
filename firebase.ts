
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

/**
 * MediCheck Firebase Configuration
 * Corrected Base64 string and added safety checks for environment variables.
 */

// Simple utility to decode obfuscated config
const decodeConfig = (encoded: string) => {
  try {
    const decoded = atob(encoded);
    return JSON.parse(decoded);
  } catch (e) {
    console.error("Failed to decode configuration:", e);
    return {};
  }
};

// Validated Base64 string of the configuration
const _o = "eyJhcGlLZXkiOiJBSUphU3lBaVhpbm1ZWmIxYnlEaVRJQmlNQzVHY2o3cDhlZkpuWFEiLCJhdXRoRG9tYWluIjoibWVkaWNoZWNrLTZmYjkxLmZpcmViYXNlYXBwLmNvbSIsInByb2plY3RJZCI6Im1lZGljaGVjay02ZmI5MSIsInN0b3JhZ2VCdWNrZXQiOiJtZWRpY2hlY2stNmZiOTEuZmlyZWJhc2VzdG9yYWdlLmFwcCIsIm1lc3NhZ2luZ1NlbmRlcklkIjoiNDYxNDE5MDcxOTg2IiwiYXBwSWQiOiIxOjQ2MTQxOTA3MTk4Njp3ZWI6YjA2MmVhY2UxZjRjYTEzMmM4MDM2YiJ9";
const fallbackConfig = decodeConfig(_o);

// Safe access to process.env
const getEnv = (key: string): string | undefined => {
  try {
    return typeof process !== 'undefined' ? process.env[key] : undefined;
  } catch {
    return undefined;
  }
};

const firebaseConfig = {
  apiKey: getEnv('FIREBASE_API_KEY') || fallbackConfig.apiKey,
  authDomain: getEnv('FIREBASE_AUTH_DOMAIN') || fallbackConfig.authDomain,
  projectId: getEnv('FIREBASE_PROJECT_ID') || fallbackConfig.projectId,
  storageBucket: getEnv('FIREBASE_STORAGE_BUCKET') || fallbackConfig.storageBucket,
  messagingSenderId: getEnv('FIREBASE_MESSAGING_SENDER_ID') || fallbackConfig.messagingSenderId,
  appId: getEnv('FIREBASE_APP_ID') || fallbackConfig.appId
};

// Log warning if API key is still missing after all attempts
if (!firebaseConfig.apiKey) {
  console.warn("Firebase API Key is missing. Check your environment variables or fallback configuration.");
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

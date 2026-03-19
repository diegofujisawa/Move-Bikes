import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';

import firebaseConfig from './firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);

if (typeof window !== 'undefined') {
  enableIndexedDbPersistence(db).catch((err) => {
    if (err.code === 'failed-precondition') {
      console.warn('Firestore persistence failed-precondition');
    } else if (err.code === 'unimplemented') {
      console.warn('Firestore persistence unimplemented');
    }
  });
}

export const auth = getAuth(app);

// Promise que resolve quando o Firebase Auth estiver pronto.
// Use: await waitForAuth() antes de qualquer escrita no Firestore.
export const waitForAuth = (): Promise<void> => {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        unsubscribe();
        resolve();
      }
    });
  });
};

// Login anônimo automático ao inicializar
if (typeof window !== 'undefined') {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      signInAnonymously(auth)
        .then(() => console.log('[Firebase] Login anônimo realizado.'))
        .catch((err) => console.error('[Firebase] Erro no login anônimo:', err));
    }
  });
}

export { db };
export default app;

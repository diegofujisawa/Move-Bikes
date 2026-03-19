import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';

// Import the Firebase configuration
import firebaseConfig from './firebase-applet-config.json';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);

// Enable offline persistence
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

// =================================================================
// LOGIN ANÔNIMO AUTOMÁTICO
//
// Garante que o app sempre tenha uma sessão Firebase Auth válida.
// Sem isso, as regras do Firestore bloqueiam todas as escritas
// porque exigem request.auth != null.
//
// O login anônimo é silencioso — sem email/senha, sem popup.
// Ocorre uma vez ao carregar o app e persiste na sessão.
// =================================================================
if (typeof window !== 'undefined') {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      // Nenhuma sessão ativa — faz login anônimo automaticamente
      signInAnonymously(auth).catch((err) => {
        console.error('Erro no login anônimo do Firebase:', err);
      });
    }
  });
}

export { db };
export default app;
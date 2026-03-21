import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged, 
  setPersistence, 
  browserLocalPersistence 
} from 'firebase/auth';
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

// Login anônimo automático ao inicializar com mecanismo de retry
const performAnonymousLogin = (retryCount = 0) => {
  const MAX_RETRIES = 5;
  
  // Verifica se está online antes de tentar
  if (typeof window !== 'undefined' && !navigator.onLine) {
    console.warn('[Firebase] Offline. Aguardando conexão para login anônimo...');
    window.addEventListener('online', () => performAnonymousLogin(retryCount), { once: true });
    return;
  }

  signInAnonymously(auth)
    .then(() => console.log('[Firebase] Login anônimo realizado com sucesso.'))
    .catch((err) => {
      console.error(`[Firebase] Erro no login anônimo (tentativa ${retryCount + 1}):`, err);
      
      // Se for erro de rede, tenta novamente com backoff exponencial
      if (err.code === 'auth/network-request-failed' && retryCount < MAX_RETRIES) {
        const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 1000;
        console.log(`[Firebase] Retentando login anônimo em ${Math.round(delay)}ms...`);
        setTimeout(() => performAnonymousLogin(retryCount + 1), delay);
      }
    });
};

// Inicialização segura
if (typeof window !== 'undefined') {
  // Garante que a persistência está configurada antes de qualquer ação
  setPersistence(auth, browserLocalPersistence)
    .then(() => {
      console.log('[Firebase] Persistência configurada.');
      onAuthStateChanged(auth, (user) => {
        if (!user) {
          performAnonymousLogin();
        } else {
          console.log('[Firebase] Usuário já autenticado:', user.uid);
        }
      });
    })
    .catch(err => {
      console.error('[Firebase] Erro ao configurar persistência:', err);
      // Tenta login mesmo se a persistência falhar
      performAnonymousLogin();
    });
}

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

export { db };
export default app;

import React, { useState, useEffect } from 'react';
import LoginScreen from './components/LoginScreen';
import MainScreen from './components/MainScreen';
import AdminMap from './components/AdminMap'; // Importa o novo componente de mapa
import { User } from './types';
import { apiCall } from './api';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(() => {
    const savedUser = localStorage.getItem('bike_app_user');
    if (savedUser) {
      try {
        return JSON.parse(savedUser);
      } catch (e) {
        console.error("Failed to parse saved user", e);
        return null;
      }
    }
    return null;
  });
  // Novo estado para controlar a visibilidade do mapa em tempo real
  const [isMapVisible, setIsMapVisible] = useState(false);

  useEffect(() => {
    if (user) {
      localStorage.setItem('bike_app_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('bike_app_user');
    }
  }, [user]);

  const handleLogin = (loggedInUser: User) => {
    if (loggedInUser && loggedInUser.name && loggedInUser.name.trim()) {
      const userWithCategory = {
        ...loggedInUser,
        category: (loggedInUser.category || 'MOTORISTA').trim().toUpperCase(),
      };
      setUser(userWithCategory);
      if (loggedInUser.sessionId) {
        localStorage.setItem('bike_app_session_id', loggedInUser.sessionId);
      }
    }
  };

  const handleLogout = (isSessionExpired = false) => {
    if (user || isSessionExpired) {
      const userNameToLogout = user?.name;
      setUser(null);
      localStorage.removeItem('bike_app_user');
      localStorage.removeItem('bike_app_session_id');
      setIsMapVisible(false); // Garante que o mapa seja fechado ao fazer logout
      
      // Se for expiração de sessão, não tentamos chamar o logout no servidor (que falharia)
      if (!isSessionExpired && userNameToLogout) {
        apiCall({ action: 'logout', userName: userNameToLogout })
          .catch(err => {
            console.error("Falha ao atualizar o status de logout no servidor:", err);
          });
      }
    }
  };

  useEffect(() => {
    const onSessionExpired = (e: any) => {
      alert(e.detail || 'Sessão encerrada.');
      handleLogout(true);
    };

    window.addEventListener('session-expired', onSessionExpired);
    return () => window.removeEventListener('session-expired', onSessionExpired);
  }, [user]);

  // Efeito para lidar com a visibilidade da página e evitar erros ao retomar o app
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('App retomado, verificando estado...');
        // Opcional: Forçar um refresh de dados leve aqui se necessário
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 font-sans flex flex-col items-center justify-center p-4">
      {isMapVisible && user?.category.includes('ADM') ? (
        // Se o mapa deve ser visível e o usuário é ADM, renderiza o AdminMap em tela cheia
        <div className="w-full h-screen max-w-full">
          <AdminMap 
            adminName={user.name} 
            onLogout={handleLogout} 
            onClose={() => setIsMapVisible(false)} 
          />
        </div>
      ) : (
        // Caso contrário, mostra a tela de login ou a tela principal
        <div className="w-full max-w-md mx-auto">
          {!user ? (
            <LoginScreen onLogin={handleLogin} />
          ) : (
            <MainScreen 
              driverName={user.name} 
              category={user.category} 
              onLogout={handleLogout}
              // Passa a função para a MainScreen poder abrir o mapa
              onShowMap={() => setIsMapVisible(true)}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default App;


import { apiCall } from './api';

export interface PendingAction {
  id: string;
  payload: any;
  timestamp: number;
  retryCount: number;
  actionName: string;
  description: string;
}

const STORAGE_KEY = 'bike_app_pending_actions';

class SyncService {
  private queue: PendingAction[] = [];
  private isSyncing = false;
  private listeners: ((queue: PendingAction[]) => void)[] = [];

  constructor() {
    if (typeof window !== 'undefined') {
      this.loadQueue();
      this.startSyncLoop();
    }
  }

  private loadQueue() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        this.queue = JSON.parse(saved);
      } catch {
        this.queue = [];
      }
    }
  }

  private saveQueue() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
    this.notifyListeners();
  }

  private notifyListeners() {
    this.listeners.forEach(l => l([...this.queue]));
  }

  public subscribe(listener: (queue: PendingAction[]) => void) {
    this.listeners.push(listener);
    listener([...this.queue]);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Adiciona uma ação à fila de sincronização.
   * @param payload O payload para apiCall
   * @param actionName Nome técnico da ação
   * @param description Descrição amigável para o usuário
   */
  public queueAction(payload: any, actionName: string, description: string) {
    const action: PendingAction = {
      id: Math.random().toString(36).substring(2, 15) + Date.now(),
      payload,
      timestamp: Date.now(),
      retryCount: 0,
      actionName,
      description
    };

    this.queue.push(action);
    this.saveQueue();
    
    // Tenta sincronizar imediatamente de forma assíncrona
    this.sync();
    return action.id;
  }

  public async sync() {
    if (this.isSyncing || this.queue.length === 0) return;
    
    // Verifica se há internet antes de tentar
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return;
    }

    this.isSyncing = true;

    // Processa um por um para garantir a ordem
    while (this.queue.length > 0) {
      const action = this.queue[0];
      try {
        // Tenta a chamada real. Usamos retries=0 pois o SyncService já gerencia as tentativas.
        await apiCall(action.payload, 0, true); 
        
        // Sucesso! Remove da fila
        this.queue.shift();
        this.saveQueue();
        
        // Pequeno delay entre envios para não sobrecarregar o Apps Script
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.warn(`Falha ao sincronizar ação "${action.description}":`, error);
        // Se falhou, incrementa o contador de tentativas e para o loop para tentar mais tarde
        // (evita ficar tentando infinitamente se o servidor estiver fora do ar)
        break;
      }
    }

    this.isSyncing = false;
  }

  private startSyncLoop() {
    // Tenta sincronizar a cada 30 segundos
    setInterval(() => {
      this.sync();
    }, 30000);

    // Tenta sincronizar quando voltar a ficar online
    window.addEventListener('online', () => {
        console.log("Conexão restaurada. Iniciando sincronização...");
        this.sync();
    });
  }

  public getPendingActions() {
    return [...this.queue];
  }

  public clearQueue() {
    this.queue = [];
    this.saveQueue();
  }
}

export const syncService = new SyncService();

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { BicycleData, PickupRequest, DriverLocation } from '../types';
import {
  LogoutIcon, PlusIcon, PlusPlusIcon, MapIcon, SheetIcon, SearchIcon,
  AlertIcon, CalendarIcon, CarIcon, XIcon, BicycleIcon, MovingIcon,
  UserIcon, AlertTriangleIcon, QrCodeIcon, TrailerIcon, SwitchIcon,
  RefreshIcon, DatabaseIcon, CheckCircleIcon
} from './icons';
import { Html5Qrcode } from 'html5-qrcode';
import { auth, db } from '../firebase';
import { waitForAuth } from '../firebase';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import {
  collection, onSnapshot, query, doc, updateDoc, addDoc,
  serverTimestamp, getDoc, setDoc, deleteDoc, getDocs
} from 'firebase/firestore';
import ScheduleModal from './ScheduleModal';
import ReporModal from './ReporModal';
import MechanicRepairModal from './MechanicRepairModal';
import MechanicSelectionModal from './MechanicSelectionModal';
import TrailerSelectionModal from './TrailerSelectionModal';
import RequestModal from './RequestModal';
import ReportModal from './ReportModal';
import RouteModal from './RouteModal';
import DestinationModal from './DestinationModal';
import HistoryModal from './HistoryModal';
import VehicleSwitchModal from './VehicleSwitchModal';
import EditDriverModal from './EditDriverModal';
import AdminAlerts from './AdminAlerts';
import { apiCall, apiGetCall } from '../api';
import { User } from '../types';
import { migrateDataToFirebase } from '../migrationService';

// =================================================================
// REGRA DE SINCRONIZAÇÃO
//
// Ação do motorista no app:
//   1. Atualiza estado local imediatamente (otimista)
//   2. Grava no Firebase (fonte de verdade em tempo real)
//   3. Envia para Sheets em paralelo (não bloqueia o motorista)
//   4. Registra lastDriverActionAt = Date.now()
//
// Sync periódico do Sheets (a cada 10s):
//   - SÓ aplica driverState do Sheets se NÃO houver ação recente do motorista
//   - "Recente" = menos de DRIVER_ACTION_GRACE_MS milissegundos
//   - Se o ADM editou a planilha E não há ação recente, aplica normalmente
//
// Listener Firestore:
//   - Sempre aplica se não há operação ativa (isUpdatingStateRef)
//   - Ignora updates com flag sheetsSync=true (vieram do próprio sync — evita loop)
// =================================================================

// Janela de proteção após ação do motorista (ms).
// Durante esse período, o sync do Sheets não sobrescreve o estado local.
const DRIVER_ACTION_GRACE_MS = 8000; // 8 segundos — cobre latência do Apps Script

interface MainScreenProps {
  driverName: string;
  category: string;
  plate?: string;
  kmInicial?: number;
  onLogout: () => void;
  onShowMap: () => void;
  onUpdateUser: (updates: Partial<User>) => void;
}

// =================================================================
// HELPERS
// =================================================================
const normalizeCoord = (coord: number): number => {
  if (isNaN(coord) || coord === null) return coord;
  if (coord >= -180 && coord <= 180) return coord;
  let val = coord;
  while (Math.abs(val) > 180) val /= 10;
  return val;
};

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371;
  const dLat = (normalizeCoord(lat2) - normalizeCoord(lat1)) * (Math.PI / 180);
  const dLon = (normalizeCoord(lon2) - normalizeCoord(lon1)) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(normalizeCoord(lat1) * Math.PI / 180)
    * Math.cos(normalizeCoord(lat2) * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const getDistanceInMeters = (lat1: number, lon1: number, lat2: number, lon2: number) =>
  calculateDistance(lat1, lon1, lat2, lon2) * 1000;

// =================================================================
// COMPONENTE PRINCIPAL
// =================================================================
const MainScreen: React.FC<MainScreenProps> = ({
  driverName, category, plate, kmInicial, onLogout, onShowMap, onUpdateUser
}) => {
  // --- UI State ---
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState(new Date().toLocaleTimeString());
  const [backendVersion, setBackendVersion] = useState<string | null>(null);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationMessage, setMigrationMessage] = useState<{ text: string, type: 'success' | 'error' | 'info' } | null>(null);

  // --- Dados principais ---
  const [routeBikes, setRouteBikes] = useState<string[]>([]);
  const [collectedBikes, setCollectedBikes] = useState<string[]>([]);
  const [routeBikesDetails, setRouteBikesDetails] = useState<Record<string, any>>({});
  const [collectedBikesDetails, setCollectedBikesDetails] = useState<Record<string, any>>({});
  const [pendingRequests, setPendingRequests] = useState<PickupRequest[]>([]);
  const [stations, setStations] = useState<any[]>([]);
  const [motoristas, setMotoristas] = useState<string[]>([]);
  const [driverLocations, setDriverLocations] = useState<DriverLocation[]>([]);
  const [bikeConflicts, setBikeConflicts] = useState<Record<string, any>>({});
  const [currentDriverLocation, setCurrentDriverLocation] = useState<{ lat: number, lng: number } | null>(null);
  const [routeDistances, setRouteDistances] = useState<Record<string, { distance: string, duration: string, value: number }>>({});

  // --- Modais ---
  const [isRequestModalOpen, setRequestModalOpen] = useState(false);
  const [isRouteModalOpen, setRouteModalOpen] = useState(false);
  const [isTrailerModalOpen, setTrailerModalOpen] = useState(false);
  const [isReportModalOpen, setReportModalOpen] = useState(false);
  const [isVehicleModalOpen, setIsVehicleModalOpen] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [isAdminAlertsOpen, setIsAdminAlertsOpen] = useState(false);
  const [isReporModalOpen, setIsReporModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isEditDriverModalOpen, setIsEditDriverModalOpen] = useState(false);
  const [isMechanicRepairModalOpen, setIsMechanicRepairModalOpen] = useState(false);
  const [isMechanicSelectionModalOpen, setIsMechanicSelectionModalOpen] = useState(false);
  const [isTrailerSelectionModalOpen, setIsTrailerSelectionModalOpen] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [destinationModal, setDestinationModal] = useState<{
    isOpen: boolean; bikeNumber: string;
    type: 'Estação' | 'Filial' | 'Vandalizada'; stationName?: string;
  }>({ isOpen: false, bikeNumber: '', type: 'Estação' });

  // --- Dados ADM ---
  const [driversSummary, setDriversSummary] = useState<any[]>([]);
  const [summaryTimeRange, setSummaryTimeRange] = useState<'day' | 'week' | 'month' | '-1' | '-7'>('day');
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [activeQuadrant, setActiveQuadrant] = useState<'summary' | 'alerts' | 'vandalized' | 'status'>('summary');
  const [alerts, setAlerts] = useState<any[]>([]);
  const [isAlertsLoading, setIsAlertsLoading] = useState(false);
  const [vandalizedBikes, setVandalizedBikes] = useState<any[]>([]);
  const [isVandalizedLoading, setIsVandalizedLoading] = useState(false);
  const [changeStatusData, setChangeStatusData] = useState<{ vandalizadas: any[], filial: any[] }>({ vandalizadas: [], filial: [] });
  const [statusTimeRange, setStatusTimeRange] = useState<'24h' | '48h' | '72h' | 'week'>('24h');
  const [alertCount, setAlertCount] = useState(0);
  const [hasNewAlerts, setHasNewAlerts] = useState(false);
  const [lastViewedAlertCount, setLastViewedAlertCount] = useState(0);
  const [editingDriver, setEditingDriver] = useState<any>(null);

  // --- Dados auxiliares ---
  const [mechanicsList, setMechanicsList] = useState<any[]>([]);
  const [selectedMechanicBike, setSelectedMechanicBike] = useState<any>(null);
  const [selectedBikesForTrailer, setSelectedBikesForTrailer] = useState<string[]>([]);
  const [reporData, setReporData] = useState<any[]>([]);
  const [isReporLoading, setIsReporLoading] = useState(false);
  const [userSchedule, setUserSchedule] = useState<Record<string, string>>({});
  const [isScheduleLoading, setIsScheduleLoading] = useState(false);
  const [requestsHistory, setRequestsHistory] = useState<any[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [processingBikes, setProcessingBikes] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [searchedBike, setSearchedBike] = useState<BicycleData | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [useDriversSummaryFallback, setUseDriversSummaryFallback] = useState(false);

  // --- Refs ---
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const searchCacheRef = useRef<Record<string, BicycleData>>({});
  const processingBikesRef = useRef<Set<string>>(new Set());
  // Ref para refreshAll — evita dependência circular com persistDriverState
  const refreshAllRef = useRef<((force?: boolean) => Promise<void>) | null>(null);
  // IDs de notificações já processadas nesta sessão (aceitas ou recusadas).
  // Garante que nunca reapareçam mesmo que o sync devolva dados antigos.
  const processedRequestIds = useRef<Set<string>>(new Set());

  // =================================================================
  // REFS DE CONTROLE DE SINCRONIZAÇÃO
  //
  // isUpdatingStateRef: true enquanto uma operação do motorista está
  //   em andamento. Bloqueia qualquer sync externo.
  //
  // lastDriverActionAt: timestamp da última ação do motorista.
  //   O sync do Sheets só aplica se (now - lastDriverActionAt) > GRACE.
  // =================================================================
  const isUpdatingStateRef = useRef(false);
  const lastDriverActionAt = useRef<number>(0);
  const lastLocationUpdateRef = useRef<number>(0);
  const lastLocationRef = useRef<{ lat: number, lng: number } | null>(null);

  const normalizedCategory = category.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const isAdm = normalizedCategory.includes('ADM');
  const isMecanica = normalizedCategory.includes('MECANICA') || normalizedCategory.includes('MECANICO');

  // =================================================================
  // HELPERS DE ESTADO
  // =================================================================

  /**
   * Marca que o motorista acabou de executar uma ação.
   * Durante DRIVER_ACTION_GRACE_MS, o sync do Sheets não sobrescreve.
   */
  const markDriverAction = () => {
    lastDriverActionAt.current = Date.now();
  };

  /**
   * Sincroniza requests do Sheets para o Firebase.
   * Sheets é a fonte de verdade para requests — se foi deletado/finalizado
   * na planilha, remove do Firebase para o listener parar de exibir.
   */
  const syncRequestsToFirebase = useCallback(async (sheetsRequests: any[]) => {
    try {
      const snapshot = await getDocs(collection(db, 'requests'));
      const firestoreIds = new Set(snapshot.docs.map(d => d.id));

      // IDs que ainda existem no Sheets como pendentes (apenas Firestore IDs)
      const activeSheetsIds = new Set(
        sheetsRequests
          .filter(r => {
            const status = (r.status || r.situacao || '').toString().toLowerCase().trim();
            return !status || status === 'pendente';
          })
          .map(r => String(r.id))
          .filter(id => id.length > 10 && isNaN(Number(id))) // só IDs do Firestore
      );

      // Deleta do Firebase qualquer request que não está mais pendente no Sheets
      const deletePromises: Promise<void>[] = [];
      snapshot.docs.forEach(docSnap => {
        const data = docSnap.data();
        const status = (data.status || '').toString().toLowerCase();
        // Se está pendente no Firebase mas não está mais no Sheets como pendente
        if (status === 'pendente' && !activeSheetsIds.has(docSnap.id)) {
          deletePromises.push(deleteDoc(doc(db, 'requests', docSnap.id)));
        }
      });

      if (deletePromises.length > 0) {
        await Promise.all(deletePromises);
      }
    } catch (e) {
      console.warn('[Sync] syncRequestsToFirebase falhou:', e);
    }
  }, []);

  /**
   * Verifica se o sync do Sheets pode sobrescrever o estado local.
   * Retorna false se houver uma ação recente do motorista.
   */
  const canSheetsOverride = () => {
    const elapsed = Date.now() - lastDriverActionAt.current;
    return elapsed > DRIVER_ACTION_GRACE_MS;
  };

  /**
   * Aplica estado vindo do Sheets, respeitando a janela de proteção.
   * Também espelha no Firebase com flag sheetsSync=true.
   */
  const applyStateFromSheets = useCallback((sheetsRoute: string[], sheetsCollected: string[]) => {
    if (isUpdatingStateRef.current) return; // operação ativa — não mexe
    if (!canSheetsOverride()) return;       // ação recente do motorista — protege

    const newCollected = [...new Set(sheetsCollected.map(String))];
    const newRoute = [...new Set(sheetsRoute.map(String))].filter(b => !newCollected.includes(b));
    const finalRoute = newRoute.filter(b => !processingBikesRef.current.has(b));
    const finalCollected = newCollected.filter(b => !processingBikesRef.current.has(b));

    setRouteBikes(prev => {
      const prevStr = [...prev].sort().join(',');
      const nextStr = [...finalRoute].sort().join(',');
      return prevStr === nextStr ? prev : finalRoute;
    });

    setCollectedBikes(prev => {
      const prevStr = [...prev].sort().join(',');
      const nextStr = [...finalCollected].sort().join(',');
      return prevStr === nextStr ? prev : finalCollected;
    });

    // Espelha no Firebase silenciosamente — flag sheetsSync=true evita loop
    setDoc(doc(db, 'users', driverName), {
      routeBikes: finalRoute,
      collectedBikes: finalCollected,
      lastUpdate: serverTimestamp(),
      sheetsSync: true,
    }, { merge: true }).catch(() => {});
  }, [driverName]);

  /**
   * Grava o estado do motorista no Firebase e envia para Sheets em paralelo.
   * Após Sheets confirmar, dispara sync imediato via ref (sem dependência circular).
   */
  const persistDriverState = useCallback(async (
    newRoute: string[],
    newCollected: string[]
  ) => {
    const dedupRoute = [...new Set(newRoute.map(String))];
    const dedupCollected = [...new Set(newCollected.map(String))];

    const t0 = Date.now();

    // Aguarda autenticação Firebase antes de qualquer escrita
    await waitForAuth();
    console.log(`[Timing] waitForAuth: ${Date.now() - t0}ms`);

    // 1. Firebase imediato (fonte de verdade)
    await setDoc(doc(db, 'users', driverName), {
      routeBikes: dedupRoute,
      collectedBikes: dedupCollected,
      lastUpdate: serverTimestamp(),
      sheetsSync: false,
    }, { merge: true });
    console.log(`[Timing] Firebase write: ${Date.now() - t0}ms`);

    // 2. Sheets em paralelo — não bloqueia o motorista
    apiCall({
      action: 'updateDriverState',
      driverName,
      routeBikes: dedupRoute,
      collectedBikes: dedupCollected,
    }, 1, true).then(() => {
      console.log(`[Timing] Sheets confirmou: ${Date.now() - t0}ms`);
      setTimeout(() => refreshAllRef.current?.(true), 0);
    }).catch(e => console.warn('[Sheets] updateDriverState falhou:', e));
  }, [driverName]);

  // =================================================================
  // NOTIFICAÇÕES
  // =================================================================
  useEffect(() => {
    if (successMessage) {
      const t = setTimeout(() => setSuccessMessage(null), 5000);
      return () => clearTimeout(t);
    }
  }, [successMessage]);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const showNotification = (title: string, body: string) => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body, icon: '/favicon.ico' }); } catch (e) {}
    }
  };

  // =================================================================
  // FIRESTORE LISTENERS
  // =================================================================
  useEffect(() => {
    if (!driverName) return;

    // Pedidos pendentes
    const qRequests = query(collection(db, 'requests'));
    const unsubRequests = onSnapshot(qRequests, (snapshot) => {
      const updated: any[] = [];
      let hasNew = false;
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') {
          const d = change.doc.data();
          if (d.status === 'PENDENTE' && (d.recipient === driverName || d.recipient === 'Todos')) hasNew = true;
        }
      });
      snapshot.forEach(doc => {
        const d = doc.data();
        const status = (d.status || d.situacao || '').toString().toLowerCase().trim();
        // Só inclui se for explicitamente pendente
        const isPending = !status || status === 'pendente';
        if (isPending && (d.recipient === driverName || d.recipient === 'Todos')) {
          updated.push({ id: doc.id, ...d });
        }
      });
      setPendingRequests(updated);
      if (hasNew) showNotification('Novo Pedido', 'Você tem uma nova solicitação pendente.');
    }, err => console.error('Listener requests:', err));

    // Alertas (ADM)
    let unsubAlerts = () => {};
    if (isAdm) {
      const qAlerts = query(collection(db, 'alerts'));
      unsubAlerts = onSnapshot(qAlerts, snapshot => {
        const updated: any[] = [];
        snapshot.forEach(doc => updated.push({ id: doc.id, ...doc.data() }));
        setAlerts(updated);
        setAlertCount(updated.length);
      }, err => console.error('Listener alertas:', err));
    }

    // Estado do motorista
    // REGRA: Só aplica se não tiver sheetsSync=true (evita loop)
    // e não tiver operação ativa.
    const unsubUser = onSnapshot(doc(db, 'users', driverName), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();

      // Ignora updates que vieram do sync do Sheets (evita loop)
      if (data.sheetsSync === true) return;

      // Ignora se há operação ativa no momento
      if (isUpdatingStateRef.current) return;

      setRouteBikes(data.routeBikes || []);
      setCollectedBikes(data.collectedBikes || []);
    }, err => console.error('Listener usuário:', err));

    return () => { unsubRequests(); unsubAlerts(); unsubUser(); };
  }, [driverName, isAdm]);

  // =================================================================
  // GARANTIA DE UNICIDADE
  // Uma bike nunca pode estar em roteiro E recolhidas ao mesmo tempo
  // =================================================================
  useEffect(() => {
    const collectedSet = new Set(collectedBikes.map(String));
    if (routeBikes.some(b => collectedSet.has(String(b)))) {
      setRouteBikes(prev => {
        const filtered = prev.filter(b => !collectedSet.has(String(b)));
        return filtered.length !== prev.length ? filtered : prev;
      });
    }
  }, [routeBikes, collectedBikes]);

  // =================================================================
  // FORMATADORES
  // =================================================================
  const formatDateTime = (date: Date) => {
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${p(date.getDate())}/${p(date.getMonth()+1)}/${date.getFullYear()} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
  };

  const formatBattery = (value: any) => {
    if (value === undefined || value === null || value === '') return '';
    const num = parseFloat(String(value).replace('%', '').replace(',', '.'));
    if (isNaN(num)) return value;
    return num <= 1 ? Math.round(num * 100) : Math.round(num);
  };

  const formatCoordinate = (coord: any): string => {
    if (coord === undefined || coord === null || coord === '') return '';
    const num = typeof coord === 'number' ? coord : parseFloat(String(coord).replace(',', '.'));
    if (isNaN(num)) return String(coord);
    return normalizeCoord(num).toString();
  };

  const formatLastInfo = (dateString: any) => {
    if (!dateString || typeof dateString !== 'string') return { text: 'N/A', color: 'text-gray-800' };
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return { text: dateString, color: 'text-gray-800' };
    const diffHours = (new Date().getTime() - date.getTime()) / (1000 * 60 * 60);
    return {
      text: formatDateTime(date),
      color: diffHours > 24 ? 'text-red-600' : diffHours > 1 ? 'text-yellow-600' : 'text-green-600'
    };
  };

  const renderConflictIcon = (bike: string) => {
    const conflict = bikeConflicts[bike];
    if (!conflict) return null;
    const othersRoute = conflict.drivers?.filter((d: string) => d !== driverName && !d.includes('(Em Posse)')) || [];
    const othersPosse = conflict.drivers?.filter((d: string) => d !== driverName && d.includes('(Em Posse)')) || [];
    const hasStatus = conflict.status && ['VANDALIZADA','MANUTENÇÃO','ROUBADA'].includes(conflict.status);
    const hasRecent = conflict.recentAction && !conflict.recentAction.startsWith(driverName);
    if (!othersRoute.length && !othersPosse.length && !hasStatus && !hasRecent) return null;
    const msgs = [
      othersRoute.length > 0 && `No roteiro de: ${othersRoute.join(', ')}`,
      othersPosse.length > 0 && `Em posse de: ${othersPosse.join(', ')}`,
      hasStatus && `Status Crítico: ${conflict.status}`,
      hasRecent && `Ação Recente: ${conflict.recentAction}`,
    ].filter(Boolean);
    return (
      <div className="group relative">
        <AlertIcon className="w-5 h-5 text-red-500" />
        <div className="absolute bottom-full mb-2 w-max max-w-[200px] px-2 py-1 bg-gray-800 text-white text-[10px] rounded-md opacity-0 group-hover:opacity-100 z-50 pointer-events-none shadow-lg">
          {msgs.map((m, i) => <p key={i}>{m as string}</p>)}
        </div>
      </div>
    );
  };

  const renderLocationWithMap = (location: string) => {
    if (!location) return null;
    const match = location.match(/(-?\d+[.,]\d+)\s*[,;]\s*(-?\d+[.,]\d+)/);
    if (match) {
      const lat = match[1].replace(',', '.'), lng = match[2].replace(',', '.');
      return (
        <div className="flex items-center gap-2 mt-1">
          <span className="text-sm font-semibold text-gray-700">Local:</span>
          <a href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-2 py-1 bg-blue-50 text-blue-600 rounded border border-blue-100 text-[10px] font-bold hover:bg-blue-100">
            <MapIcon className="w-3 h-3" /> Ver no Mapa
          </a>
        </div>
      );
    }
    return <p className="text-sm text-gray-700 break-all"><span className="font-semibold">Local:</span> {location}</p>;
  };

  // =================================================================
  // MEMOS
  // =================================================================
  const sortedRouteBikes = useMemo(() => {
    if (!currentDriverLocation || !routeBikes.length) return routeBikes;
    return [...routeBikes].sort((a, b) => {
      if (routeDistances[a] && routeDistances[b]) return routeDistances[a].value - routeDistances[b].value;
      const dA = routeBikesDetails[a], dB = routeBikesDetails[b];
      if (!dA || !dB) return 0;
      if (!dA.currentLat || !dA.currentLng) return 1;
      if (!dB.currentLat || !dB.currentLng) return -1;
      return calculateDistance(currentDriverLocation.lat, currentDriverLocation.lng, dA.currentLat, dA.currentLng)
           - calculateDistance(currentDriverLocation.lat, currentDriverLocation.lng, dB.currentLat, dB.currentLng);
    });
  }, [routeBikes, routeBikesDetails, currentDriverLocation, routeDistances]);

  const sortedCollectedBikes = useMemo(() => {
    return [...collectedBikes].sort((a, b) => {
      const nA = parseInt(a, 10) || 0, nB = parseInt(b, 10) || 0;
      if (nA !== nB) return nA - nB;
      return (collectedBikesDetails[b]?.battery ?? 0) - (collectedBikesDetails[a]?.battery ?? 0);
    });
  }, [collectedBikes, collectedBikesDetails]);

  const allActiveBikes = useMemo(() => {
    const bikes = new Set<string>();
    driversSummary.forEach(d => {
      (d.realTime.route || []).forEach((b: string) => bikes.add(String(b).trim()));
      (d.realTime.collected || []).forEach((b: string) => bikes.add(String(b).trim()));
    });
    return bikes;
  }, [driversSummary]);

  // =================================================================
  // AÇÕES DO MOTORISTA
  //
  // PADRÃO para toda ação:
  //   1. Marca operação ativa
  //   2. Atualiza estado local (otimista)
  //   3. Grava no Firebase + Sheets via persistDriverState()
  //   4. Registra markDriverAction()
  //   5. Libera operação
  // =================================================================

  const handleStatusUpdate = async (status: string) => {
    if (!searchedBike) return;
    const bikeNumber = String(searchedBike['Patrimônio']);
    if (processingBikesRef.current.has(bikeNumber)) return;

    processingBikesRef.current.add(bikeNumber);
    setProcessingBikes(new Set(processingBikesRef.current));
    isUpdatingStateRef.current = true;
    setIsLoading(true);

    try {
      // Aguarda autenticação Firebase antes de qualquer escrita
      await waitForAuth();
      const userRef = doc(db, 'users', driverName);
      const snap = await getDoc(userRef);
      const userData = snap.data() || {};
      let newRoute: string[] = userData.routeBikes || [];
      let newCollected: string[] = userData.collectedBikes || [];

      if (status === 'Recolhida') {
        if (collectedBikes.includes(bikeNumber)) {
          alert(`Você já está em posse da bicicleta ${bikeNumber}.`);
          return;
        }
        newCollected = [...new Set([...newCollected, bikeNumber])];
        newRoute = newRoute.filter(b => String(b) !== bikeNumber);

        // Atualiza estado local imediatamente
        setCollectedBikes(newCollected);
        setRouteBikes(newRoute);

        // Firebase + Sheets
        await persistDriverState(newRoute, newCollected);

        // Status da bike
        await setDoc(doc(db, 'bikes', bikeNumber), {
          status: 'Recolhida', responsavel: driverName, ultimaAtualizacao: serverTimestamp()
        }, { merge: true });

        // Log no Firestore
        await addDoc(collection(db, 'reports'), {
          driverName, bikeNumber, status: 'Recolhida', timestamp: serverTimestamp(), observation: ''
        });

        // Log no Sheets
        apiCall({
          action: 'finalizeRouteBike', driverName, bikeNumber,
          finalStatus: 'Recolhida', finalObservation: ''
        }, 1, true).catch(e => console.warn('[Sheets] finalizeRouteBike:', e));

        setSuccessMessage(`Bicicleta ${bikeNumber} recolhida!`);
        setSearchedBike(null);
        setSearchTerm('');

      } else if (status === 'Não encontrada') {
        newRoute = newRoute.filter(b => String(b) !== bikeNumber);

        setRouteBikes(newRoute);
        await persistDriverState(newRoute, newCollected);

        await setDoc(doc(db, 'bikes', bikeNumber), {
          status: 'Não encontrada', responsavel: null, ultimaAtualizacao: serverTimestamp()
        }, { merge: true });

        await addDoc(collection(db, 'reports'), {
          driverName, bikeNumber, status: 'Não encontrada', timestamp: serverTimestamp(), observation: ''
        });

        apiCall({
          action: 'finalizeRouteBike', driverName, bikeNumber,
          finalStatus: 'Não encontrada', finalObservation: ''
        }, 1, true).catch(e => console.warn('[Sheets] finalizeRouteBike:', e));

        setSuccessMessage(`Bicicleta ${bikeNumber} marcada como não encontrada.`);
        setSearchedBike(null);
        setSearchTerm('');
      }

      markDriverAction();
    } catch (err: any) {
      console.error('Erro ao atualizar status:', err);
      setError('Erro ao atualizar status: ' + err.message);
    } finally {
      isUpdatingStateRef.current = false;
      setIsLoading(false);
      processingBikesRef.current.delete(bikeNumber);
      setProcessingBikes(new Set(processingBikesRef.current));
    }
  };

  const handleNaoAtendidaClick = async (bikeNumberInput: string | number, silent = false) => {
    const bikeNumber = String(bikeNumberInput);
    isUpdatingStateRef.current = true;
    if (!silent) setIsLoading(true);
    try {
      const snap = await getDoc(doc(db, 'users', driverName));
      const userData = snap.data() || {};
      const newRoute = (userData.routeBikes || []).filter((b: string) => String(b) !== bikeNumber);
      const newCollected = userData.collectedBikes || [];

      setRouteBikes(newRoute);
      await persistDriverState(newRoute, newCollected);

      await setDoc(doc(db, 'bikes', bikeNumber), {
        status: 'Pendente', responsavel: null, ultimaAtualizacao: serverTimestamp()
      }, { merge: true });

      await addDoc(collection(db, 'reports'), {
        driverName, bikeNumber, status: 'Não atendida', timestamp: serverTimestamp(), observation: ''
      });

      apiCall({
        action: 'finalizeRouteBike', driverName, bikeNumber,
        finalStatus: 'Não atendida', finalObservation: ''
      }, 1, true).catch(e => console.warn('[Sheets] finalizeRouteBike:', e));

      markDriverAction();
      if (!silent) setSuccessMessage(`Bicicleta ${bikeNumber} marcada como não atendida.`);
    } catch (err: any) {
      console.error('Erro não atendida:', err);
      if (!silent) setError(`Erro ao processar bike ${bikeNumber}: ${err.message}`);
    } finally {
      isUpdatingStateRef.current = false;
      if (!silent) setIsLoading(false);
    }
  };

  const executeCollectedBikeAction = async (bikeNumberInput: string | number, status: string, observation: string) => {
    const bikeNumber = String(bikeNumberInput);
    if (processingBikesRef.current.has(bikeNumber)) return;
    if (!collectedBikes.map(String).includes(bikeNumber)) {
      alert(`A bicicleta ${bikeNumber} não está mais em sua posse.`);
      setDestinationModal(prev => ({ ...prev, isOpen: false }));
      return;
    }

    setDestinationModal(prev => ({ ...prev, isOpen: false }));
    isUpdatingStateRef.current = true;
    processingBikesRef.current.add(bikeNumber);
    setProcessingBikes(new Set(processingBikesRef.current));
    setIsLoading(true);

    // Atualização otimista imediata
    setCollectedBikes(prev => prev.filter(b => String(b) !== bikeNumber));

    try {
      const snap = await getDoc(doc(db, 'users', driverName));
      const userData = snap.data() || {};
      const newCollected = (userData.collectedBikes || []).filter((b: string) => String(b) !== bikeNumber);
      const newRoute = userData.routeBikes || [];

      await persistDriverState(newRoute, newCollected);

      const finalStatus = status === 'Enviada para Estação' ? 'Estação'
        : status === 'Enviada para Filial' ? 'Filial'
        : status;

      await setDoc(doc(db, 'bikes', bikeNumber), {
        status: finalStatus, responsavel: null,
        observacao: observation, ultimaAtualizacao: serverTimestamp()
      }, { merge: true });

      await addDoc(collection(db, 'reports'), {
        driverName, bikeNumber, status: finalStatus,
        observation, timestamp: serverTimestamp()
      });

      apiCall({
        action: 'finalizeCollectedBike', driverName, bikeNumber,
        finalStatus, finalObservation: observation
      }, 1, true).catch(e => console.warn('[Sheets] finalizeCollectedBike:', e));

      markDriverAction();
      setSuccessMessage(`Bicicleta ${bikeNumber} finalizada!`);
    } catch (err: any) {
      console.error(`Erro bike ${bikeNumber}:`, err);
      setError(`Erro ao processar bike ${bikeNumber}: ${err.message}`);
      // Reverte atualização otimista em caso de erro
      setCollectedBikes(prev => [...new Set([...prev, bikeNumber])]);
    } finally {
      isUpdatingStateRef.current = false;
      setIsLoading(false);
      processingBikesRef.current.delete(bikeNumber);
      setProcessingBikes(new Set(processingBikesRef.current));
    }
  };

  // =================================================================
  // SOLICITAÇÕES
  // =================================================================
  const handleAcceptRequest = async (requestId: string, bikeNumbers: string, reason: string = '') => {
    if (isLoading) return;
    const bikesToAdd = String(bikeNumbers || '').split(',').map(s => s.trim()).filter(Boolean);
    const alreadyInPosse = bikesToAdd.filter(b => collectedBikes.includes(b));
    if (alreadyInPosse.length > 0) { alert(`Bikes já em sua posse: ${alreadyInPosse.join(', ')}`); return; }

    const isTrailer = (reason || '').toUpperCase().includes('CARRETINHA');
    isUpdatingStateRef.current = true;
    setIsLoading(true);

    // Remove da lista IMEDIATAMENTE — antes de qualquer chamada async
    processedRequestIds.current.add(String(requestId));
    setPendingRequests(prev => prev.filter(r => String(r.id) !== String(requestId)));

    try {
      // IDs numéricos vêm do Sheets (número da linha) — não existem no Firestore.
      // IDs alfanuméricos longos vêm do Firestore — podem ser atualizados diretamente.
      const isFirestoreId = String(requestId).length > 10 && isNaN(Number(requestId));
      if (isFirestoreId) {
        await updateDoc(doc(db, 'requests', String(requestId)), {
          status: 'ACEITO', driverName, acceptedAt: serverTimestamp()
        });
      }
      // Se vier do Sheets, o Sheets cuida do status via apiCall abaixo

      const snap = await getDoc(doc(db, 'users', driverName));
      const userData = snap.data() || {};
      let newRoute: string[] = userData.routeBikes || [];
      let newCollected: string[] = userData.collectedBikes || [];

      if (isTrailer) {
        newCollected = [...new Set([...newCollected, ...bikesToAdd])];
        newRoute = newRoute.filter(b => !bikesToAdd.includes(String(b)));
        setCollectedBikes(newCollected);
        setRouteBikes(newRoute);
        await Promise.all(bikesToAdd.map(id => setDoc(doc(db, 'bikes', id), {
          status: 'Recolhida', responsavel: driverName, ultimaAtualizacao: serverTimestamp()
        }, { merge: true })));
      } else {
        newRoute = [...new Set([...newRoute, ...bikesToAdd])];
        newCollected = newCollected.filter(b => !bikesToAdd.includes(String(b)));
        setRouteBikes(newRoute);
        setCollectedBikes(newCollected);
        await Promise.all(bikesToAdd.map(id => setDoc(doc(db, 'bikes', id), {
          status: 'Em Rota', responsavel: driverName, ultimaAtualizacao: serverTimestamp()
        }, { merge: true })));
      }

      await persistDriverState(newRoute, newCollected);

      // Sheets
      apiCall({ action: 'acceptRequest', requestId, driverName }, 1, true)
        .catch(e => console.warn('[Sheets] acceptRequest:', e));

      markDriverAction();
      setSuccessMessage('Pedido aceito!');
    } catch (err: any) {
      console.error('Erro aceitar pedido:', err);
      setError('Erro ao aceitar pedido: ' + err.message);
    } finally {
      isUpdatingStateRef.current = false;
      setIsLoading(false);
    }
  };

  const handleDeclineRequest = async (requestId: string) => {
    if (isLoading) return;
    isUpdatingStateRef.current = true;
    setIsLoading(true);

    // Marca como processado imediatamente — nunca mais aparece na lista
    processedRequestIds.current.add(String(requestId));
    setPendingRequests(prev => prev.filter(r => String(r.id) !== String(requestId)));
    try {
      const isFirestoreId = String(requestId).length > 10 && isNaN(Number(requestId));
      if (isFirestoreId) {
        await updateDoc(doc(db, 'requests', String(requestId)), {
          status: 'RECUSADO', declinedBy: driverName, declinedAt: serverTimestamp()
        });
      }
      apiCall({ action: 'declineRequest', requestId, driverName }, 1, true)
        .catch(e => console.warn('[Sheets] declineRequest:', e));
      setSuccessMessage('Pedido recusado.');
    } catch (err: any) {
      setError('Erro ao recusar pedido: ' + err.message);
    } finally {
      isUpdatingStateRef.current = false;
      setIsLoading(false);
    }
  };

  const handleCreateRequest = async (details: { bikeNumber: string; location: string; reason: string; recipient: string }) => {
    setIsLoading(true);
    try {
      let coords = { latitude: 0, longitude: 0 };
      try { coords = await getCurrentPosition(); } catch {}
      await addDoc(collection(db, 'requests'), {
        bikeNumber: details.bikeNumber, location: details.location,
        reason: details.reason, recipient: details.recipient,
        status: 'Pendente', timestamp: serverTimestamp(),
        driverName, latitude: coords.latitude, longitude: coords.longitude
      });
      apiCall({ action: 'createRequest', patrimonio: details.bikeNumber, ocorrencia: details.reason, local: details.location, recipient: details.recipient }, 1, true)
        .catch(e => console.warn('[Sheets] createRequest:', e));
      alert('Solicitação criada!');
      setRequestModalOpen(false);
      refreshAll(true);
    } catch (err: any) {
      alert(`Erro: ${err.message}`);
    } finally { setIsLoading(false); }
  };

  const handleCreateRoute = async (details: { routeName: string; bikeNumbers: string[]; recipient: string }) => {
    if (!details.bikeNumbers?.length) { alert('Insira ao menos uma bicicleta.'); return; }
    setIsLoading(true);
    try {
      let coords = { latitude: 0, longitude: 0 };
      try { coords = await getCurrentPosition(); } catch {}
      await addDoc(collection(db, 'requests'), {
        bikeNumber: details.bikeNumbers.join(', '), location: 'Criado via Roteiro App',
        reason: details.routeName || 'Roteiro', recipient: details.recipient || 'Todos',
        status: 'Pendente', timestamp: serverTimestamp(),
        driverName, latitude: coords.latitude, longitude: coords.longitude
      });
      const result = await apiCall({
        action: 'createRequest', patrimonio: details.bikeNumbers.join(', '),
        ocorrencia: details.routeName || 'Roteiro', local: 'Criado via Roteiro App',
        recipient: details.recipient || 'Todos'
      });
      if (result.success) { alert('Roteiro enviado!'); setRouteModalOpen(false); refreshAll(true); }
      else throw new Error(result.error);
    } catch (err: any) {
      alert(`Erro: ${err.message}`);
    } finally { setIsLoading(false); }
  };

  const handleCreateTrailer = async (details: { routeName: string; bikeNumbers: string[]; recipient: string }) => {
    if (!details.bikeNumbers?.length) { alert('Insira ao menos uma bicicleta.'); return; }
    setIsLoading(true);
    try {
      let coords = { latitude: 0, longitude: 0 };
      try { coords = await getCurrentPosition(); } catch {}
      await addDoc(collection(db, 'requests'), {
        bikeNumber: details.bikeNumbers.join(', '), location: 'Criado via Carretinha App',
        reason: `[CARRETINHA] ${details.routeName || 'Sem Nome'}`,
        recipient: details.recipient || 'Todos', status: 'Pendente',
        timestamp: serverTimestamp(), driverName, latitude: coords.latitude, longitude: coords.longitude
      });
      const result = await apiCall({
        action: 'createRequest', patrimonio: details.bikeNumbers.join(', '),
        ocorrencia: `[CARRETINHA] ${details.routeName || 'Sem Nome'}`,
        local: 'Criado via Carretinha App', recipient: details.recipient || 'Todos'
      });
      if (result.success) { alert('Carretinha enviada!'); setTrailerModalOpen(false); refreshAll(true); }
      else throw new Error(result.error);
    } catch (err: any) {
      alert(`Erro: ${err.message}`);
    } finally { setIsLoading(false); }
  };

  // =================================================================
  // BUSCA
  // =================================================================
  const handleSearch = async (bikeToSearch?: string) => {
    const term = (bikeToSearch || searchTerm).trim();
    if (!term) { setSearchedBike(null); setSearchTerm(''); return; }
    if (bikeToSearch) setSearchTerm(bikeToSearch);

    const cached = searchCacheRef.current[term];
    if (cached) {
      setSearchedBike(cached);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      apiCall({ action: 'search', bikeNumber: term }, 1, true).then(r => {
        if (r.success && r.data) {
          const s = { ...r.data, 'Patrimônio': String(r.data['Patrimônio']) };
          searchCacheRef.current[term] = s;
          setSearchedBike(s);
        }
      }).catch(() => {});
      return;
    }

    setIsSearching(true);
    setError(null);
    try {
      const result = await apiCall({ action: 'search', bikeNumber: term });
      if (result.success && result.data) {
        const s = { ...result.data, 'Patrimônio': String(result.data['Patrimônio']) };
        setSearchedBike(s);
        searchCacheRef.current[term] = s;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        setSearchedBike(null);
        setError(result.error || 'Bike não encontrada.');
      }
    } catch (err: any) {
      setSearchedBike(null);
      setError(err.message);
    } finally { setIsSearching(false); }
  };

  // =================================================================
  // ESTAÇÃO / POSIÇÃO
  // =================================================================
  const getCurrentPosition = (): Promise<{ latitude: number; longitude: number }> =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('Geolocalização não suportada.')); return; }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        err => reject(new Error(err.message)),
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 3000 }
      );
    });

  const getNearestStation = async (): Promise<string> => {
    try {
      const pos = await getCurrentPosition();
      const closest = stations.reduce((prev, curr) => {
        const dist = getDistanceInMeters(pos.latitude, pos.longitude, curr.Latitude, curr.Longitude);
        return dist < prev.minDistance ? { station: curr, minDistance: dist } : prev;
      }, { station: null as any, minDistance: Infinity });
      return closest.station && closest.minDistance <= 50 ? closest.station.Name : 'Fora da Estação';
    } catch { return 'Fora da Estação'; }
  };

  const handleCollectedBikeAction = (bikeNumber: string, status: string) => {
    if (status === 'Enviada para Estação') {
      let initial = 'Buscando...';
      if (currentDriverLocation) {
        const closest = stations.reduce((prev, curr) => {
          const dist = getDistanceInMeters(currentDriverLocation.lat, currentDriverLocation.lng, curr.Latitude, curr.Longitude);
          return dist < prev.minDistance ? { station: curr, minDistance: dist } : prev;
        }, { station: null as any, minDistance: Infinity });
        initial = closest.station && closest.minDistance <= 50 ? closest.station.Name : 'Fora da Estação';
      }
      setDestinationModal({ isOpen: true, bikeNumber, type: 'Estação', stationName: initial });
      if (initial === 'Buscando...') {
        getNearestStation().then(name =>
          setDestinationModal(prev => prev.isOpen && prev.bikeNumber === bikeNumber ? { ...prev, stationName: name } : prev)
        );
      }
    } else if (status === 'Enviada para Filial') {
      setDestinationModal({ isOpen: true, bikeNumber, type: 'Filial' });
    } else if (status === 'Vandalizada') {
      setDestinationModal({ isOpen: true, bikeNumber, type: 'Vandalizada' });
    }
  };

  const recalculateStation = async () => {
    const bikeNumber = destinationModal.bikeNumber;
    setDestinationModal(prev => ({ ...prev, stationName: 'Buscando...' }));
    const name = await getNearestStation();
    setDestinationModal(prev => prev.isOpen && prev.bikeNumber === bikeNumber ? { ...prev, stationName: name } : prev);
  };

  // =================================================================
  // MECÂNICA
  // =================================================================
  const handleConfirmMechanicsReceipt = (bikeNumber: string) => {
    setSelectedMechanicBike({ patrimonio: bikeNumber });
    setIsMechanicSelectionModalOpen(true);
  };

  const handleMechanicSelectionConfirm = async (mechanicName: string) => {
    setIsLoading(true);
    try {
      const bikeNumber = selectedMechanicBike.patrimonio;
      await updateDoc(doc(db, 'bikes', bikeNumber), { status: 'Mecânica', responsavel: mechanicName, ultimaAtualizacao: serverTimestamp() });
      await addDoc(collection(db, 'reports'), { bikeNumber, status: 'Mecânica', driverName, mechanicName, timestamp: serverTimestamp(), type: 'Mecânica' });
      apiCall({ action: 'confirmMechanicsReceipt', bikeNumber, mechanicName }, 1, true).catch(() => {});
      alert('Recebimento confirmado!');
      setIsMechanicSelectionModalOpen(false);
      refreshAll(true);
    } catch (err: any) { alert('Erro: ' + err.message); }
    finally { setIsLoading(false); }
  };

  const handleFinalizeMechanicsRepair = async (treatment: string) => {
    if (!treatment) { alert('Descreva a tratativa.'); return; }
    setIsLoading(true);
    try {
      const bikeNumber = selectedMechanicBike.patrimonio;
      await updateDoc(doc(db, 'bikes', bikeNumber), { status: 'Em Estação', responsavel: null, observacao: treatment, ultimaAtualizacao: serverTimestamp() });
      await addDoc(collection(db, 'reports'), { bikeNumber, status: 'Em Estação', driverName, treatment, timestamp: serverTimestamp(), type: 'Reparo' });
      apiCall({ action: 'finalizeMechanicsRepair', bikeNumber, mechanicName: driverName, treatment }, 1, true).catch(() => {});
      alert('Reparo finalizado!');
      setIsMechanicRepairModalOpen(false);
      refreshAll(true);
    } catch (err: any) { alert('Erro: ' + err.message); }
    finally { setIsLoading(false); }
  };

  const handleOrganizeTrailer = async (bikeNumbers: string[], trailerName: string) => {
    if (!trailerName) { alert('Informe o nome da carretinha.'); return; }
    setIsLoading(true);
    try {
      await Promise.all(bikeNumbers.map(id => updateDoc(doc(db, 'bikes', id), { carretinha: trailerName, ultimaAtualizacao: serverTimestamp() })));
      apiCall({ action: 'organizeTrailer', bikeNumbers, trailerName }, 1, true).catch(() => {});
      alert('Organizado!');
      refreshAll(true);
    } catch (err: any) { alert('Erro: ' + err.message); }
    finally { setIsLoading(false); }
  };

  const handleFinalizeTrailer = async (trailerName: string) => {
    setIsLoading(true);
    try {
      const bikes = Object.entries(collectedBikesDetails).filter(([, d]) => d.carretinha === trailerName).map(([id]) => id);
      await Promise.all(bikes.map(id => setDoc(doc(db, 'bikes', id), { carretinha: null, ultimaAtualizacao: serverTimestamp() }, { merge: true })));
      apiCall({ action: 'finalizeTrailer', trailerName }, 1, true).catch(() => {});
      alert('Carretinha finalizada!');
      refreshAll(true);
    } catch (err: any) { alert('Erro: ' + err.message); }
    finally { setIsLoading(false); }
  };

  const handleUpdateDriverState = async (targetDriver: string, route: string[], collected: string[]) => {
    setIsLoading(true);
    try {
      await setDoc(doc(db, 'users', targetDriver), { routeBikes: route, collectedBikes: collected, lastUpdate: serverTimestamp(), sheetsSync: false }, { merge: true });
      await Promise.all([
        ...route.map(id => setDoc(doc(db, 'bikes', id), { status: 'Em Rota', responsavel: targetDriver, ultimaAtualizacao: serverTimestamp() }, { merge: true })),
        ...collected.map(id => setDoc(doc(db, 'bikes', id), { status: 'Recolhida', responsavel: targetDriver, ultimaAtualizacao: serverTimestamp() }, { merge: true })),
      ]);
      const result = await apiCall({ action: 'updateDriverState', driverName: targetDriver, routeBikes: route, collectedBikes: collected });
      if (result.success) { alert(`Estado de ${targetDriver} atualizado!`); refreshAll(true); setIsEditDriverModalOpen(false); }
      else throw new Error(result.error);
    } catch (err: any) { alert('Erro: ' + err.message); }
    finally { setIsLoading(false); }
  };

  // =================================================================
  // SCANNER QR
  // =================================================================
  const startScanner = async () => {
    setIsScannerOpen(true);
    setTimeout(async () => {
      try {
        const qr = new Html5Qrcode('qr-reader');
        scannerRef.current = qr;
        await qr.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 250, height: 250 } },
          (text) => {
            const match = text.match(/\/download\/(\d+)/);
            const id = match ? match[1] : /^\d+$/.test(text) ? text : null;
            if (id) { setSearchTerm(id); stopScanner(); handleSearch(id); }
          }, () => {}
        );
      } catch { setError('Não foi possível acessar a câmera.'); setIsScannerOpen(false); }
    }, 100);
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); await scannerRef.current.clear(); } catch {}
      scannerRef.current = null;
    }
    setIsScannerOpen(false);
  };

  useEffect(() => { return () => { if (scannerRef.current) scannerRef.current.stop().catch(() => {}); }; }, []);

  // =================================================================
  // MIGRAÇÃO
  // =================================================================
  const handleMigrate = async () => {
    setMigrationMessage({ text: 'Autenticando...', type: 'info' });
    setIsMigrating(true);
    try {
      if (!auth.currentUser) await signInWithPopup(auth, new GoogleAuthProvider());
      setMigrationMessage({ text: 'Migrando dados...', type: 'info' });
      const result = await migrateDataToFirebase(category);
      setMigrationMessage(result.success
        ? { text: 'Migração concluída!', type: 'success' }
        : { text: 'Erro: ' + result.error, type: 'error' });
    } catch (err: any) {
      setMigrationMessage({ text: 'Erro: ' + err.message, type: 'error' });
    } finally {
      setIsMigrating(false);
      setTimeout(() => setMigrationMessage(null), 10000);
    }
  };

  // =================================================================
  // SUMMARY / ALERTAS / SCHEDULE (dados auxiliares)
  // =================================================================
  const fetchSchedule = async () => {
    setIsScheduleLoading(true);
    try {
      const r = await apiCall({ action: 'getSchedule', driverName }, 1, true);
      if (r.success) setUserSchedule(r.data);
    } catch {} finally { setIsScheduleLoading(false); }
  };

  const fetchReporData = async () => {
    setIsReporLoading(true);
    try {
      const r = await apiGetCall('getReporData');
      if (r.success) setReporData(r.data);
      else throw new Error(r.error);
    } catch (err: any) { setError('Erro ao carregar reposição: ' + err.message); }
    finally { setIsReporLoading(false); }
  };

  const fetchRequestsHistory = async () => {
    setIsHistoryLoading(true);
    try {
      const r = await apiCall({ action: 'getRequestsHistory', driverName, category }, 1, true);
      if (r.success) setRequestsHistory(r.data);
    } catch {} finally { setIsHistoryLoading(false); }
  };

  const fetchAlerts = async () => {
    if (!category.includes('ADM')) return;
    setIsAlertsLoading(true);
    try {
      const r = await apiGetCall('getAlerts');
      if (r.success) { setAlerts(r.data); if (r.version) setBackendVersion(r.version); }
    } catch {} finally { setIsAlertsLoading(false); }
  };

  const handleConfirmFound = async (alertId: number) => {
    if (!window.confirm('Confirmar que esta bicicleta foi encontrada?')) return;
    setIsLoading(true);
    try {
      const r = await apiCall({ action: 'confirmBikeFound', alertId, driverName });
      if (r.success) { fetchAlerts(); alert('Bicicleta marcada como encontrada!'); }
      else throw new Error(r.error);
    } catch (err: any) { alert('Erro: ' + err.message); }
    finally { setIsLoading(false); }
  };

  const handleConfirmVandalizedFound = async (alertId: number) => {
    if (!window.confirm('Confirmar que esta bicicleta foi encontrada?')) return;
    setIsLoading(true);
    try {
      const r = await apiCall({ action: 'confirmVandalizedFound', alertId, driverName });
      if (r.success) { refreshAll(true); alert('Bicicleta vandalizada marcada como encontrada!'); }
      else throw new Error(r.error);
    } catch (err: any) { alert('Erro: ' + err.message); }
    finally { setIsLoading(false); }
  };

  const fetchDriversSummary = async () => {
    const range = summaryTimeRange;
    setIsSummaryLoading(true);
    try {
      const r = await apiCall({ action: 'getDriversSummary', timeRange: range }, 1, true);
      if (r.success && summaryTimeRange === range) setDriversSummary(r.data);
      else if (!r.success) await runDriversSummaryFallback();
    } catch { await runDriversSummaryFallback(); }
    finally { setIsSummaryLoading(false); }
  };

  useEffect(() => { fetchDriversSummary(); }, [summaryTimeRange]);

  const runDriversSummaryFallback = async () => {
    const range = summaryTimeRange;
    try {
      let drivers: string[] = category.includes('ADM')
        ? ((await apiCall({ action: 'getMotoristas' })).data || [])
        : [driverName];
      const reqResult = await apiCall({ action: 'getRequests', driverName, category }, 1, true);
      const allPending = reqResult.success ? reqResult.data : [];
      const summary = await Promise.all(drivers.map(async (d: string) => {
        const [stateRes, reportRes] = await Promise.all([
          apiCall({ action: 'getDriverState', driverName: d }),
          apiCall({ action: 'getDailyReportData', driverName: d, timeRange: range })
        ]);
        const stats = { recolhidas: 0, remanejada: 0, naoEncontrada: 0, naoAtendida: 0 };
        if (reportRes.success) {
          stats.recolhidas = reportRes.data.recolhidas?.length || 0;
          stats.remanejada = reportRes.data.remanejadas?.length || 0;
          stats.naoEncontrada = reportRes.data.naoEncontrada?.length || 0;
          stats.naoAtendida = reportRes.data.naoAtendida?.length || 0;
        }
        const pendingCount = allPending.filter((r: any) => {
          const rec = (r.recipient || 'Todos').toLowerCase();
          return rec === 'todos' || rec === d.toLowerCase();
        }).length;
        return { name: d, stats, realTime: { route: stateRes.success ? stateRes.data.routeBikes : [], collected: stateRes.success ? stateRes.data.collectedBikes : [] }, pendingRequests: pendingCount };
      }));
      if (summaryTimeRange === range) setDriversSummary(summary);
    } catch (err) { console.error('Fallback summary:', err); }
  };

  const copyToClipboard = (list: string[]) => {
    navigator.clipboard.writeText(list.join(',')).then(() => alert('Copiado!')).catch(() => alert('Erro ao copiar.'));
  };

  // =================================================================
  // REFRESH ALL
  //
  // Aplica dados do Sheets exceto driverState, que só é aplicado
  // se não houver ação recente do motorista (canSheetsOverride).
  // =================================================================
  const refreshAll = useCallback(async (force = false) => {
    refreshAllRef.current = refreshAll;
    if (!force && (document.visibilityState === 'hidden' || isUpdatingStateRef.current)) return;

    setIsSyncing(true);
    if (isAdm) { setIsSummaryLoading(true); setIsAlertsLoading(true); setIsVandalizedLoading(true); }

    const applyData = (d: any) => {
      if (d.requests) {
        const pendingOnly = d.requests.filter((r: any) => {
          if (processedRequestIds.current.has(String(r.id))) return false;
          const status = (r.status || r.situacao || '').toString().toLowerCase().trim();
          return !status || status === 'pendente';
        });
        setPendingRequests(pendingOnly);
        // Sheets é fonte de verdade — sincroniza Firebase removendo o que não existe mais
        syncRequestsToFirebase(d.requests);
      }
      if (d.driverState && !isUpdatingStateRef.current && canSheetsOverride()) {
        applyStateFromSheets(
          d.driverState.routeBikes || [],
          d.driverState.collectedBikes || []
        );
      }

      if (d.bikeStatuses) setBikeConflicts(d.bikeStatuses);
      if (d.schedule) setUserSchedule(d.schedule);
      if (d.motoristas) setMotoristas(d.motoristas);
      if (d.driverLocations) setDriverLocations(d.driverLocations);
      if (d.mechanicsList) setMechanicsList(d.mechanicsList);
      if (d.driversSummary) setDriversSummary(d.driversSummary);

      if (d.bikeDetails) {
        const details = d.bikeDetails;
        const routeD: Record<string, any> = {}, collectedD: Record<string, any> = {};
        (d.driverState?.routeBikes || []).forEach((b: string) => { if (details[b]) routeD[b] = details[b]; });
        (d.driverState?.collectedBikes || []).forEach((b: string) => { if (details[b]) collectedD[b] = details[b]; });
        setRouteBikesDetails(prev => {
          const next = { ...routeD };
          Object.keys(next).forEach(id => {
            if (prev[id]?.initialLat != null) {
              next[id].initialLat = prev[id].initialLat;
              next[id].initialLng = prev[id].initialLng;
            }
          });
          return next;
        });
        setCollectedBikesDetails(collectedD);
      }

      if (isAdm) {
        if (d.alerts) setAlerts(d.alerts);
        if (d.vandalized) setVandalizedBikes(d.vandalized);
        if (d.changeStatusData) setChangeStatusData(d.changeStatusData);
        if (d.adminAlerts) {
          const n = d.adminAlerts.length;
          setAlertCount(n);
          if (n > lastViewedAlertCount) setHasNewAlerts(true);
        }
      }
    };

    try {
      setSyncError(null);
      const result = await apiCall({ action: 'sync', driverName, category, summaryTimeRange, statusTimeRange }, 2, true);
      if (result.success && result.data) {
        applyData(result.data);
        localStorage.setItem('cached_main_data', JSON.stringify(result.data));
        if (result.version) setBackendVersion(result.version);
        setLastSyncTime(new Date().toLocaleTimeString());
      } else {
        setSyncError(result.error || 'Falha na sincronização.');
      }
    } catch (err: any) {
      setSyncError(err.message || 'Erro de conexão.');
      const cached = localStorage.getItem('cached_main_data');
      if (cached) { try { applyData(JSON.parse(cached)); } catch {} }
    } finally {
      setIsSyncing(false);
      if (isAdm) { setIsSummaryLoading(false); setIsAlertsLoading(false); setIsVandalizedLoading(false); }
    }
  }, [driverName, category, summaryTimeRange, statusTimeRange, applyStateFromSheets, isAdm, lastViewedAlertCount]);

  // Cache inicial
  useEffect(() => {
    const cached = localStorage.getItem('cached_main_data');
    if (!cached) return;
    try {
      const d = JSON.parse(cached);
      if (d.requests) {
        const pendingOnly = d.requests.filter((r: any) => {
          if (processedRequestIds.current.has(String(r.id))) return false;
          const status = (r.status || r.situacao || '').toString().toLowerCase().trim();
          return !status || status === 'pendente';
        });
        setPendingRequests(pendingOnly);
      }
      if (d.driverState) { setRouteBikes(d.driverState.routeBikes || []); setCollectedBikes(d.driverState.collectedBikes || []); }
      if (d.bikeStatuses) setBikeConflicts(d.bikeStatuses);
      if (d.schedule) setUserSchedule(d.schedule);
      if (d.motoristas) setMotoristas(d.motoristas);
      if (d.driverLocations) setDriverLocations(d.driverLocations);
      if (d.mechanicsList) setMechanicsList(d.mechanicsList);
      if (d.driversSummary) setDriversSummary(d.driversSummary);
      if (d.alerts) setAlerts(d.alerts);
      if (d.vandalized) setVandalizedBikes(d.vandalized);
      if (d.changeStatusData) setChangeStatusData(d.changeStatusData);
    } catch {}
  }, []);

  // Sync periódico — 4s para reduzir delay percebido
  useEffect(() => {
    refreshAll();
    const fetchSt = async () => {
      try {
        const r = await apiGetCall('getStations');
        if (r.success && r.data) setStations(r.data.map((s: any) => ({ ...s, Latitude: normalizeCoord(s.Latitude), Longitude: normalizeCoord(s.Longitude) })));
      } catch {}
    };
    fetchSt();
    const interval = setInterval(() => refreshAll(), 4000);
    const onVisibility = () => { if (document.visibilityState === 'visible') refreshAll(true); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisibility); };
  }, [refreshAll]);

  // Distâncias Haversine
  useEffect(() => {
    if (!currentDriverLocation || !routeBikes.length) return;
    const dists: Record<string, any> = {};
    routeBikes.forEach(id => {
      const d = routeBikesDetails[id];
      if (d?.currentLat && d?.currentLng) {
        const km = calculateDistance(currentDriverLocation.lat, currentDriverLocation.lng, d.currentLat, d.currentLng);
        dists[id] = { distance: km < 1 ? `${(km*1000).toFixed(0)}m` : `${km.toFixed(1)}km`, duration: `~${Math.round(km*3)} min`, value: km*1000 };
      }
    });
    setRouteDistances(dists);
  }, [currentDriverLocation, routeBikes, routeBikesDetails]);

  // GPS
  useEffect(() => {
    if (category.toUpperCase() !== 'MOTORISTA') return;
    if (!navigator.geolocation) { setGpsError('Seu navegador não suporta geolocalização.'); return; }
    const watchId = navigator.geolocation.watchPosition(
      ({ coords: { latitude, longitude } }) => {
        setGpsError(null);
        setCurrentDriverLocation({ lat: latitude, lng: longitude });
        const now = Date.now();
        const last = lastLocationRef.current;
        if (now - lastLocationUpdateRef.current > 10000) {
          const moved = !last || getDistanceInMeters(latitude, longitude, last.lat, last.lng) > 10;
          if (moved) {
            lastLocationUpdateRef.current = now;
            lastLocationRef.current = { lat: latitude, lng: longitude };
            setDoc(doc(db, 'users', driverName), { currentLat: latitude, currentLng: longitude, lastLocationUpdate: serverTimestamp(), category }, { merge: true }).catch(() => {});
            apiGetCall('updateLocation', { driverName, latitude: latitude.toFixed(6), longitude: longitude.toFixed(6) }).catch(() => {});
          }
        }
      },
      err => {
        if (err.code === err.PERMISSION_DENIED) setGpsError('Acesso ao GPS negado. O aplicativo requer localização ativa.');
        else if (err.code === err.POSITION_UNAVAILABLE) setGpsError('Localização indisponível. Verifique se o GPS está ligado.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [driverName, category]);

  // =================================================================
  // GPS BLOQUEIO
  // =================================================================
  if (gpsError) {
    return (
      <div className="fixed inset-0 bg-white z-[9999] flex flex-col items-center justify-center p-6 text-center">
        <AlertTriangleIcon className="w-16 h-16 text-red-500 mb-4" />
        <h1 className="text-2xl font-bold text-gray-900 mb-2">GPS Obrigatório</h1>
        <p className="text-gray-600 mb-6 max-w-xs">{gpsError}<br /><br />O Move Bikes requer localização ativa.</p>
        <button onClick={() => window.location.reload()} className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 active:scale-95">Tentar Novamente</button>
      </div>
    );
  }

  // =================================================================
  // RENDER
  // =================================================================
  return (
    <div className="bg-white p-4 sm:p-6 rounded-xl shadow-lg w-full max-w-4xl mx-auto animate-fade-in-down">
      {migrationMessage && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[10000] p-4 rounded-lg shadow-2xl border flex items-center gap-3 ${
          migrationMessage.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' :
          migrationMessage.type === 'error'   ? 'bg-red-50 border-red-200 text-red-800' :
                                                'bg-blue-50 border-blue-200 text-blue-800'}`}>
          {migrationMessage.type === 'success' ? <CheckCircleIcon className="w-5 h-5" /> :
           migrationMessage.type === 'error'   ? <AlertTriangleIcon className="w-5 h-5" /> :
                                                 <RefreshIcon className="w-5 h-5 animate-spin" />}
          <p className="text-sm font-medium">{migrationMessage.text}</p>
          <button onClick={() => setMigrationMessage(null)} className="ml-2 opacity-50 hover:opacity-100"><XIcon className="w-4 h-4" /></button>
        </div>
      )}

      {/* HEADER */}
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 pb-4 border-b">
        <div>
          <p className="font-bold text-base text-gray-800">{driverName}</p>
          <div className="flex items-center gap-2">
            <p className="text-xs text-gray-600 uppercase tracking-wider">{category}</p>
            <span className={`text-[10px] flex items-center gap-1 cursor-help ${syncError ? 'text-red-500 font-bold' : 'text-gray-400'}`}
              title={syncError || 'Sincronizado'} onClick={() => syncError && alert(syncError)}>
              <span className={`w-1.5 h-1.5 rounded-full ${isSyncing ? 'bg-blue-500 animate-pulse' : syncError ? 'bg-red-500' : 'bg-green-500'}`}></span>
              {syncError ? 'Erro Planilha' : lastSyncTime}
            </span>
          </div>
        </div>
        <div className="flex items-center flex-wrap gap-1 mt-4 sm:mt-0">
          {isAdm && (
            <button onClick={handleMigrate} disabled={isMigrating} title="Migrar para Firebase"
              className={`p-1.5 sm:p-2 rounded-full transition-colors ${isMigrating ? 'text-orange-500 animate-spin' : 'text-gray-500 hover:bg-gray-100 hover:text-orange-600'}`}>
              <DatabaseIcon className="w-6 h-6 sm:w-7 sm:h-7" />
            </button>
          )}
          {!isMecanica && <>
            <button onClick={() => setRequestModalOpen(true)} disabled={isLoading} title="Nova Solicitação" className="p-1.5 sm:p-2 rounded-full text-gray-500 hover:bg-gray-100 hover:text-blue-600 disabled:opacity-50"><PlusIcon className="w-6 h-6 sm:w-7 sm:h-7"/></button>
            <button onClick={() => setRouteModalOpen(true)} disabled={isLoading} title="Criar Roteiro" className="p-1.5 sm:p-2 rounded-full text-gray-500 hover:bg-gray-100 hover:text-blue-600 disabled:opacity-50"><PlusPlusIcon className="w-6 h-6 sm:w-7 sm:h-7"/></button>
            <button onClick={() => setTrailerModalOpen(true)} disabled={isLoading} title="Carretinha" className="p-1.5 sm:p-2 rounded-full text-gray-500 hover:bg-gray-100 hover:text-blue-600 disabled:opacity-50"><TrailerIcon className="w-6 h-6 sm:w-7 sm:h-7"/></button>
            <button onClick={() => { setIsAdminAlertsOpen(true); setHasNewAlerts(false); setAlertCount(0); setLastViewedAlertCount(alertCount); }} disabled={isLoading} title="Alertas"
              className={`p-1.5 sm:p-2 rounded-full relative disabled:opacity-50 ${hasNewAlerts && alertCount > 0 ? 'text-red-600 bg-red-50 animate-pulse' : 'text-gray-500 hover:bg-gray-100 hover:text-red-600'}`}>
              <AlertTriangleIcon className={`w-6 h-6 sm:w-7 sm:h-7 ${hasNewAlerts && alertCount > 0 ? 'animate-bounce' : ''}`}/>
              {alertCount > 0 && <span className="absolute top-0 right-0 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full border-2 border-white">{alertCount}</span>}
            </button>
            {isAdm && <button onClick={onShowMap} disabled={isLoading} title="Mapa" className="p-1.5 sm:p-2 rounded-full text-gray-500 hover:bg-gray-100 hover:text-blue-600 disabled:opacity-50"><MapIcon className="w-6 h-6 sm:w-7 sm:h-7"/></button>}
            {normalizedCategory.includes('MOTORISTA') && <>
              <button onClick={() => setIsVehicleModalOpen(true)} disabled={isLoading} title="Trocar Veículo" className="p-1.5 sm:p-2 rounded-full text-gray-500 hover:bg-gray-100 hover:text-blue-600 disabled:opacity-50"><SwitchIcon className="w-6 h-6 sm:w-7 sm:h-7"/></button>
              <button onClick={() => { fetchSchedule(); setIsScheduleModalOpen(true); }} disabled={isLoading} title="Escala" className="p-1.5 sm:p-2 rounded-full text-gray-500 hover:bg-gray-100 hover:text-blue-600 disabled:opacity-50"><CalendarIcon className="w-6 h-6 sm:w-7 sm:h-7"/></button>
            </>}
            {!isAdm && <>
              <button onClick={() => window.open('https://docs.google.com/forms/d/e/1FAIpQLSdYtWC_KKixt9gWwZG_Q6hyaD2QCvv-_ilOfhtUVJiF5EevSQ/viewform', '_blank')} disabled={isLoading} title="Formulário Veículo" className="p-1.5 sm:p-2 rounded-full text-gray-500 hover:bg-gray-100 hover:text-blue-600 disabled:opacity-50"><CarIcon className="w-6 h-6 sm:w-7 sm:h-7"/></button>
              <button onClick={() => setReportModalOpen(true)} disabled={isLoading} title="Relatório" className="p-1.5 sm:p-2 rounded-full text-gray-500 hover:bg-gray-100 hover:text-blue-600 disabled:opacity-50"><SheetIcon className="w-6 h-6 sm:w-7 sm:h-7"/></button>
            </>}
            <button onClick={() => { fetchReporData(); setIsReporModalOpen(true); }} disabled={isLoading} title="Estações Livres" className="p-1.5 sm:p-2 rounded-full text-gray-500 hover:bg-gray-100 hover:text-blue-600 disabled:opacity-50"><BicycleIcon className="w-6 h-6 sm:w-7 sm:h-7"/></button>
          </>}
          <button onClick={onLogout} disabled={isLoading} title="Sair" className="p-1.5 sm:p-2 rounded-full text-gray-500 hover:bg-gray-100 hover:text-red-600 disabled:opacity-50"><LogoutIcon className="w-6 h-6 sm:w-7 sm:h-7"/></button>
        </div>
      </header>

      <main>
        {/* RESUMO MOTORISTA */}
        {!isAdm && !isMecanica && driversSummary.length > 0 && (
          <div className="mb-4 p-3 border rounded-lg bg-gray-50 shadow-sm">
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-sm font-bold text-gray-700 uppercase flex items-center gap-2"><SheetIcon className="w-4 h-4 text-blue-600"/>Resumo</h2>
              <div className="flex bg-white border rounded-md p-0.5 shadow-sm">
                {(['-1','-7','day','week','month'] as const).map(r => (
                  <button key={r} onClick={() => setSummaryTimeRange(r)}
                    className={`px-2 py-0.5 text-[9px] font-bold uppercase rounded ${summaryTimeRange === r ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
                    {r === '-1' ? '-1' : r === '-7' ? '-7' : r === 'day' ? 'Dia' : r === 'week' ? 'Semana' : 'Mês'}
                  </button>
                ))}
              </div>
            </div>
            {driversSummary.filter(d => d.name.toLowerCase() === driverName.toLowerCase()).map(driver => (
              <div key={driver.name} className="grid grid-cols-5 gap-1.5">
                {[
                  { label: 'Notif.', value: driver.pendingRequests, c: 'blue' },
                  { label: 'Recolh.', value: driver.stats.recolhidas, c: 'green' },
                  { label: 'Remanej.', value: driver.stats.remanejada, c: 'indigo' },
                  { label: 'Não Enc.', value: driver.stats.naoEncontrada, c: 'red' },
                  { label: 'Não Atend.', value: driver.stats.naoAtendida || 0, c: 'orange' },
                ].map(item => (
                  <div key={item.label} className={`bg-${item.c}-50 p-1.5 rounded border border-${item.c}-100 text-center`}>
                    <p className={`text-[8px] text-${item.c}-600 font-black uppercase leading-tight`}>{item.label}</p>
                    <p className={`text-sm font-black text-${item.c}-800`}>{item.value}</p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* BUSCA */}
        {!isAdm && (
          <div className="mb-4 p-3 border rounded-lg bg-gray-50">
            <h2 className="text-base font-medium text-gray-700 mb-2">Consultar Bicicleta</h2>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-grow">
                  <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                    placeholder="Digite o patrimônio..."
                    className="w-full p-1.5 pr-8 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"/>
                  {searchTerm && (
                    <button onClick={() => { setSearchTerm(''); setSearchedBike(null); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><XIcon className="w-4 h-4"/></button>
                  )}
                </div>
                <button onClick={() => isScannerOpen ? stopScanner() : startScanner()}
                  className={`p-1.5 rounded-md border ${isScannerOpen ? 'bg-red-50 border-red-200 text-red-600' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                  title={isScannerOpen ? 'Fechar Scanner' : 'QR Code'}>
                  <QrCodeIcon className="w-5 h-5"/>
                </button>
                <button onClick={() => handleSearch()} disabled={isSearching || isScannerOpen}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 active:scale-95 disabled:bg-gray-400 flex items-center gap-2 text-sm">
                  {isSearching ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/> : <SearchIcon className="w-4 h-4"/>}
                  <span>{isSearching ? 'Buscando...' : 'Consultar'}</span>
                </button>
              </div>
              {isScannerOpen && (
                <div className="relative overflow-hidden rounded-lg bg-black aspect-square max-w-[300px] mx-auto w-full border-2 border-blue-500 shadow-xl">
                  <div id="qr-reader" className="w-full h-full"/>
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center"><div className="w-48 h-48 border-2 border-blue-400/50 rounded-lg"/></div>
                  <button onClick={stopScanner} className="absolute top-2 right-2 bg-black/50 text-white p-1 rounded-full"><XIcon className="w-4 h-4"/></button>
                  <p className="absolute bottom-2 left-0 right-0 text-center text-[10px] text-white bg-black/50 py-1">Aponte para o QR Code</p>
                </div>
              )}
            </div>
          </div>
        )}

        {error && <div className="text-red-600 bg-red-100 p-3 rounded-md text-sm mb-4">{error}</div>}
        {successMessage && <div className="text-green-600 bg-green-100 p-3 rounded-md text-sm mb-4">{successMessage}</div>}

        {/* RESULTADO DA BUSCA */}
        {!isAdm && searchedBike && (
          <div className="p-4 border rounded-lg bg-green-50 animate-fade-in-down relative mb-4">
            <button onClick={() => { setSearchedBike(null); setSearchTerm(''); }} className="absolute top-2 right-2 p-1 text-green-700 hover:bg-green-100 rounded-full"><XIcon className="w-5 h-5"/></button>
            <h3 className="text-lg font-semibold text-green-800 mb-3">Resultado da Consulta</h3>
            {collectedBikes.includes(String(searchedBike['Patrimônio'])) && (
              <div className="mb-3 p-2 bg-yellow-100 border border-yellow-400 text-yellow-800 text-[10px] font-bold rounded flex items-center gap-2">
                <AlertTriangleIcon className="w-4 h-4"/><span>ATENÇÃO: Você já está em posse desta bicicleta.</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {[
                { label: 'Status', value: searchedBike['Status'] },
                { label: 'Bateria', value: `${formatBattery(searchedBike['Bateria'])}%` },
                { label: 'Localidade', value: searchedBike['Localidade'] },
                { label: 'Trava', value: searchedBike['Trava'] },
                { label: 'Usuário', value: searchedBike['Usuário'] },
                { label: 'Carregamento', value: searchedBike['Carregamento'] },
              ].map(item => (
                <div key={item.label}>
                  <p className="font-semibold text-gray-500 text-xs uppercase">{item.label}</p>
                  <p className="text-gray-800 font-medium">{item.value}</p>
                </div>
              ))}
              <div>
                <p className="font-semibold text-gray-500 text-xs uppercase">Coordenadas</p>
                <a href={`https://www.google.com/maps/search/?api=1&query=${formatCoordinate(searchedBike['Latitude'])},${formatCoordinate(searchedBike['Longitude'])}`}
                  target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium truncate block">
                  {`${formatCoordinate(searchedBike['Latitude'])}, ${formatCoordinate(searchedBike['Longitude'])}`}
                </a>
              </div>
              <div>
                <p className="font-semibold text-gray-500 text-xs uppercase">Última Info</p>
                <p className={`font-medium ${formatLastInfo(searchedBike['Última informação da posição']).color}`}>
                  {formatLastInfo(searchedBike['Última informação da posição']).text}
                </p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-green-200 grid grid-cols-2 gap-2">
              <button onClick={() => handleStatusUpdate('Recolhida')} disabled={isLoading || processingBikes.has(String(searchedBike['Patrimônio']))}
                className="px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm disabled:bg-gray-400">Recolhida</button>
              <button onClick={() => handleStatusUpdate('Não encontrada')} disabled={isLoading || processingBikes.has(String(searchedBike['Patrimônio']))}
                className="px-3 py-1.5 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm disabled:bg-gray-400">Não Encontrada</button>
            </div>
          </div>
        )}

        {/* NOTIFICAÇÕES */}
        <div className="mt-6 p-4 border rounded-lg bg-gray-50">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-semibold text-gray-700">Notificações Pendentes</h2>
            <button onClick={() => { setIsHistoryModalOpen(true); fetchRequestsHistory(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-bold text-gray-600 hover:bg-gray-50 hover:text-blue-600 shadow-sm">
              <CalendarIcon className="w-3.5 h-3.5"/>Ver Histórico
            </button>
          </div>
          {(() => {
            // Filtra notificações já processadas nesta sessão E que não sejam mais pendentes
            const visibleRequests = pendingRequests.filter(req => {
              if (processedRequestIds.current.has(String(req.id))) return false;
              const status = (req.status || req.situacao || '').toString().toLowerCase().trim();
              // Só exibe se explicitamente pendente — aceita/finalizada/recusada não aparecem
              if (status && status !== 'pendente') return false;
              return true;
            });
            return visibleRequests.length > 0 ? (
              <ul className="space-y-3">
                {visibleRequests.map(req => (
                <li key={req.id} className="p-3 bg-white border rounded-md shadow-sm flex justify-between items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-bold text-blue-600">Bicicleta: {req.bikeNumber}</p>
                      {renderConflictIcon(req.bikeNumber)}
                    </div>
                    <p className="text-sm text-gray-700 mb-1"><span className="font-semibold">Motivo:</span> {req.reason}</p>
                    {renderLocationWithMap(req.location)}
                  </div>
                  <div className="flex flex-col gap-4 items-end pt-1">
                    <button onClick={() => handleAcceptRequest(req.id, req.bikeNumber, req.reason)} disabled={isLoading} className="text-green-600 hover:text-green-700 text-sm font-bold disabled:text-gray-400">Aceitar</button>
                    <button onClick={() => handleDeclineRequest(req.id)} disabled={isLoading} className="text-red-600 hover:text-red-700 text-sm font-bold disabled:text-gray-400">Recusar</button>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-gray-500">Nenhuma notificação pendente.</p>;
          })()}
        </div>

        {/* MECÂNICA */}
        {isMecanica && (
          <div className="mt-6 space-y-6">
            {[
              { status: 'Aguardando Confirmação', title: 'Filial - Aguardando Confirmação', bg: 'blue', Icon: CarIcon,
                action: (bike: any) => <button onClick={() => handleConfirmMechanicsReceipt(bike.patrimonio)} className="px-3 py-1 bg-blue-600 text-white text-xs font-bold rounded hover:bg-blue-700 active:scale-95">Confirmar Recebimento</button> },
              { status: 'Em Manutenção', title: 'Mecânica - Em Manutenção', bg: 'orange', Icon: BicycleIcon,
                action: (bike: any) => <button onClick={() => { setSelectedMechanicBike(bike); setIsMechanicRepairModalOpen(true); }} className="px-3 py-1 bg-orange-600 text-white text-xs font-bold rounded hover:bg-orange-700 active:scale-95">Finalizar Reparo</button> },
            ].map(({ status, title, bg, Icon, action }) => (
              <div key={status} className={`p-4 border rounded-lg bg-${bg}-50 shadow-sm`}>
                <h2 className={`text-lg font-bold text-${bg}-800 mb-3 flex items-center gap-2`}><Icon className="w-5 h-5"/>{title}</h2>
                {mechanicsList.filter(b => b.status === status).length > 0 ? (
                  <div className="space-y-2">
                    {mechanicsList.filter(b => b.status === status).map(bike => (
                      <div key={bike.patrimonio} className="flex justify-between items-center p-3 bg-white border rounded-md shadow-sm">
                        <div>
                          <span className="font-bold text-gray-700">Bike: {bike.patrimonio}</span>
                          {bike.bateria !== undefined && <p className="text-[10px] text-gray-600">Bateria: {bike.bateria}%</p>}
                          {bike.mecanico && <p className="text-[10px] font-bold text-blue-600">Mecânico: {bike.mecanico}</p>}
                          {bike.tratativa && <p className="text-[10px] text-gray-500 italic">Obs: {bike.tratativa}</p>}
                        </div>
                        {action(bike)}
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-gray-500 italic">Nenhuma bike.</p>}
              </div>
            ))}

            <div className="p-4 border rounded-lg bg-green-50 shadow-sm">
              <h2 className="text-lg font-bold text-green-800 mb-3 flex items-center gap-2"><TrailerIcon className="w-5 h-5"/>Reserva - Prontas para Remanejamento</h2>
              {mechanicsList.filter(b => b.status === 'Reserva').length > 0 ? (
                <div className="space-y-4">
                  {Object.entries(
                    mechanicsList.filter(b => b.status === 'Reserva').reduce((acc, bike) => {
                      const key = bike.carretinha || 'Sem Carretinha';
                      if (!acc[key]) acc[key] = [];
                      acc[key].push(bike);
                      return acc;
                    }, {} as Record<string, any[]>)
                  ).map(([trailer, bikes]) => (
                    <div key={trailer} className="border border-green-200 rounded-md bg-white p-3 shadow-sm">
                      <div className="flex justify-between items-center mb-2 border-b pb-1">
                        <h3 className="font-bold text-green-700 flex items-center gap-2"><TrailerIcon className="w-4 h-4"/>{trailer}</h3>
                        {trailer !== 'Sem Carretinha' && (
                          <button onClick={() => handleFinalizeTrailer(trailer)} className="text-[10px] bg-green-600 text-white px-2 py-0.5 rounded font-bold hover:bg-green-700">Finalizar Carretinha</button>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {(bikes as any[]).map(bike => (
                          <div key={bike.patrimonio} className="text-xs p-1 bg-gray-50 border rounded text-center font-medium text-gray-700 flex flex-col items-center">
                            <span>{bike.patrimonio}</span>
                            {bike.bateria !== undefined && <span className="text-[8px] text-gray-500">{bike.bateria}%</span>}
                          </div>
                        ))}
                      </div>
                      {trailer === 'Sem Carretinha' && (
                        <button onClick={() => { setSelectedBikesForTrailer((bikes as any[]).map(b => b.patrimonio)); setIsTrailerSelectionModalOpen(true); }}
                          className="mt-3 w-full py-1.5 bg-blue-600 text-white text-[10px] font-bold rounded hover:bg-blue-700">
                          Organizar em Carretinha
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-gray-500 italic">Nenhuma bike na reserva.</p>}
            </div>
          </div>
        )}

        {/* PAINEL ADM */}
        {isAdm && (
          <div className="mt-6 overflow-hidden">
            <div className="flex gap-2 mb-2 px-1">
              {[
                { key: 'summary', icon: <UserIcon className="w-5 h-5"/>, color: 'blue' },
                { key: 'alerts', icon: <AlertIcon className="w-5 h-5"/>, color: 'red' },
                { key: 'vandalized', icon: <AlertTriangleIcon className="w-5 h-5"/>, color: 'orange' },
                { key: 'status', icon: <PlusPlusIcon className="w-5 h-5"/>, color: 'blue' },
              ].map(({ key, icon, color }) => (
                <button key={key} onClick={() => setActiveQuadrant(key as any)}
                  className={`p-2 rounded-full transition-all ${activeQuadrant === key ? `bg-${color}-600 text-white shadow-md` : 'bg-gray-200 text-gray-500'}`}>
                  {icon}
                </button>
              ))}
            </div>

            <div className="relative w-full overflow-hidden rounded-lg border bg-gray-50 shadow-inner min-h-[400px]">
              <div className="flex transition-transform duration-500 ease-in-out"
                style={{ transform: `translateX(${activeQuadrant === 'summary' ? '0%' : activeQuadrant === 'alerts' ? '-100%' : activeQuadrant === 'vandalized' ? '-200%' : '-300%'})` }}>

                {/* Quadrante 1: Resumo */}
                <div className="w-full flex-shrink-0 p-3">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-base font-bold text-gray-700 flex items-center gap-2">
                      <SheetIcon className={`w-4 h-4 ${isSummaryLoading ? 'animate-pulse text-blue-400' : 'text-blue-600'}`}/>
                      Analítico
                      {backendVersion && <span className="text-[9px] text-gray-400 font-mono ml-2">v{backendVersion}</span>}
                    </h2>
                    <div className="flex bg-white border rounded-md p-0.5 shadow-sm">
                      {(['-1','-7','day','week','month'] as const).map(r => (
                        <button key={r} onClick={() => setSummaryTimeRange(r)}
                          className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded ${summaryTimeRange === r ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
                          {r === '-1' ? '-1' : r === '-7' ? '-7' : r === 'day' ? 'Dia' : r === 'week' ? 'Sem' : 'Mês'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {driversSummary.length > 0 ? (
                    <div className="grid grid-cols-1 gap-3">
                      {driversSummary.map(driver => (
                        <div key={driver.name} className="bg-white p-3 rounded-lg border shadow-sm">
                          <div className="flex justify-between items-center mb-2 border-b pb-1">
                            <h3 className="font-black text-gray-900 text-sm uppercase">{driver.name}</h3>
                            <button onClick={() => { setEditingDriver(driver); setIsEditDriverModalOpen(true); }} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-full">
                              <SearchIcon className="w-4 h-4"/>
                            </button>
                          </div>
                          <div className="grid grid-cols-5 gap-1.5 mb-3">
                            {[
                              { l: 'Notif.', v: driver.pendingRequests, c: 'blue' },
                              { l: 'Recolh.', v: driver.stats.recolhidas, c: 'green' },
                              { l: 'Remanej.', v: driver.stats.remanejada, c: 'indigo' },
                              { l: 'Não Enc.', v: driver.stats.naoEncontrada, c: 'red' },
                              { l: 'Não Atend.', v: driver.stats.naoAtendida || 0, c: 'orange' },
                            ].map(item => (
                              <div key={item.l} className={`bg-${item.c}-50 p-1.5 rounded border border-${item.c}-100 text-center`}>
                                <p className={`text-[8px] text-${item.c}-600 font-black uppercase leading-tight`}>{item.l}</p>
                                <p className={`text-sm font-black text-${item.c}-800`}>{item.v}</p>
                              </div>
                            ))}
                          </div>
                          <div className="mb-2">
                            <p className="text-[9px] font-black text-gray-500 uppercase mb-1">Bikes em Posse ({driver.realTime.collected.length})</p>
                            {driver.realTime.collected.length > 0
                              ? <div className="flex flex-wrap gap-1">{driver.realTime.collected.map((b: string) => <span key={b} className="px-1.5 py-0.5 bg-gray-50 text-gray-700 rounded text-[10px] font-mono border border-gray-200">{b}</span>)}</div>
                              : <p className="text-[9px] text-gray-400 italic">Nenhuma bike recolhida</p>}
                          </div>
                          <div>
                            <p className="text-[9px] font-black text-gray-500 uppercase mb-1">Roteiro Atual ({driver.realTime.route.length})</p>
                            {driver.realTime.route.length > 0
                              ? <div className="flex flex-wrap gap-1">{driver.realTime.route.map((b: string) => <span key={b} className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-mono border border-blue-100">{b}</span>)}</div>
                              : <p className="text-[9px] text-gray-400 italic">Roteiro vazio</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <div className="text-center py-6 bg-white rounded-lg border border-dashed"><p className="text-gray-400 text-xs">Carregando...</p></div>}
                </div>

                {/* Quadrante 2: Alertas */}
                <div className="w-full flex-shrink-0 p-3">
                  <h2 className="text-base font-bold text-gray-700 flex items-center gap-2 mb-4"><AlertIcon className="w-4 h-4 text-red-600"/>Bikes em Alerta</h2>
                  <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead><tr className="bg-gray-100 border-b">
                        {['Patrimônio','Check 1','Check 2','Check 3','Ação'].map(h => (
                          <th key={h} className="p-2 text-[10px] font-black text-gray-600 uppercase text-center first:text-left">{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {alerts.length > 0 ? alerts.map(alert => (
                          <tr key={alert.id} className="border-b hover:bg-gray-50">
                            <td className="p-2 font-mono text-xs font-bold text-gray-700">{alert.patrimonio}</td>
                            {['check1','check2','check3'].map(c => (
                              <td key={c} className="p-2 text-center"><input type="checkbox" checked={!!alert[c]} readOnly className="w-4 h-4 rounded border-gray-300"/></td>
                            ))}
                            <td className="p-2 text-center">
                              {alert.situacao === 'Localizada'
                                ? <button onClick={() => handleConfirmFound(alert.id)} disabled={isLoading} className="px-2 py-1 bg-green-600 text-white text-[10px] font-bold rounded hover:bg-green-700 disabled:bg-gray-400">{isLoading ? '...' : 'Confirmar'}</button>
                                : <span className="text-[10px] text-gray-400 italic">Pendente</span>}
                            </td>
                          </tr>
                        )) : (
                          <tr><td colSpan={5} className="p-4 text-center text-gray-400 text-xs italic">{isAlertsLoading ? 'Buscando...' : 'Nenhuma bike em alerta.'}</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Quadrante 3: Vandalizadas */}
                <div className="w-full flex-shrink-0 p-3">
                  <h2 className="text-base font-bold text-gray-700 flex items-center gap-2 mb-4"><AlertTriangleIcon className="w-4 h-4 text-orange-600"/>Bikes Vandalizadas</h2>
                  <div className="bg-white rounded-lg border shadow-sm overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[500px]">
                      <thead><tr className="bg-gray-100 border-b">
                        {['Patrimônio','Data','Defeito','Local','Ação'].map(h => (
                          <th key={h} className="p-2 text-[10px] font-black text-gray-600 uppercase">{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {vandalizedBikes.length > 0 ? vandalizedBikes.map(v => (
                          <tr key={v.id} className="border-b hover:bg-gray-50">
                            <td className="p-2 font-mono text-xs font-bold text-gray-700">{v.patrimonio}</td>
                            <td className="p-2 text-[10px] text-gray-600">{new Date(v.data).toLocaleDateString()}</td>
                            <td className="p-2 text-[10px] text-gray-600">{v.defeito}</td>
                            <td className="p-2 text-[10px] text-gray-600">{v.local}</td>
                            <td className="p-2 text-center">
                              <button onClick={() => handleConfirmVandalizedFound(v.id)} disabled={isLoading} className="px-2 py-1 bg-orange-600 text-white text-[10px] font-bold rounded hover:bg-orange-700 disabled:bg-gray-400">{isLoading ? '...' : 'Encontrada'}</button>
                            </td>
                          </tr>
                        )) : (
                          <tr><td colSpan={5} className="p-4 text-center text-gray-400 text-xs italic">{isVandalizedLoading ? 'Buscando...' : 'Nenhuma bike vandalizada.'}</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Quadrante 4: Alterar Status */}
                <div className="min-w-full p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                    <div className="flex items-center gap-2"><BicycleIcon className="w-5 h-5 text-blue-600"/><h3 className="text-lg font-bold text-gray-800">Alterar Status</h3></div>
                    <div className="flex items-center gap-2 bg-white p-1 rounded-lg border shadow-sm">
                      <span className="text-[10px] font-bold text-gray-400 uppercase ml-2">Período:</span>
                      <select value={statusTimeRange} onChange={e => setStatusTimeRange(e.target.value as any)} className="text-xs font-bold text-gray-600 bg-transparent border-none focus:ring-0 cursor-pointer py-1 pr-8">
                        <option value="24h">Últimas 24h</option>
                        <option value="48h">Últimas 48h</option>
                        <option value="72h">Últimas 72h</option>
                        <option value="week">Última Semana</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[
                      { key: 'vandalizadas', label: 'Vandalizadas', color: 'orange', data: changeStatusData.vandalizadas },
                      { key: 'filial', label: 'Filial', color: 'blue', data: changeStatusData.filial },
                    ].map(({ key, label, color, data }) => (
                      <div key={key} className="bg-white p-3 rounded-lg border shadow-sm">
                        <div className="flex justify-between items-center mb-2">
                          <h4 className={`text-sm font-bold text-${color}-700 uppercase tracking-wider`}>{label}</h4>
                          <button onClick={() => copyToClipboard(data.map((v: any) => v.patrimonio))} className="px-2 py-1 bg-gray-100 text-gray-600 text-[10px] font-bold rounded hover:bg-gray-200 flex items-center gap-1">
                            <SheetIcon className="w-3 h-3"/> Copiar Lista
                          </button>
                        </div>
                        <div className="max-h-[200px] overflow-y-auto bg-gray-50 rounded p-2 border border-dashed">
                          {data.length > 0
                            ? <p className="text-xs font-mono break-all text-gray-600 leading-relaxed">{data.map((v: any) => v.patrimonio).join(',')}</p>
                            : <p className="text-xs text-gray-400 italic text-center py-4">Nenhuma bike.</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ROTEIRO DE RECOLHAS */}
        {!isAdm && !isMecanica && (
          <div className="mt-6 p-4 border rounded-lg bg-gray-50">
            <h2 className="text-lg font-semibold text-gray-700 mb-3">Roteiro de Recolhas</h2>
            {sortedRouteBikes.length > 0 ? (
              <ul className="space-y-2">
                {sortedRouteBikes.map(bike => {
                  const details = routeBikesDetails[bike];
                  const moved = details?.currentLat && details?.currentLng && details?.initialLat && details?.initialLng
                    ? getDistanceInMeters(details.initialLat, details.initialLng, details.currentLat, details.currentLng) : 0;
                  const dist = currentDriverLocation && details?.currentLat && details?.currentLng
                    ? calculateDistance(currentDriverLocation.lat, currentDriverLocation.lng, details.currentLat, details.currentLng) : null;
                  return (
                    <li key={bike} className="p-3 bg-white border rounded-md flex flex-col gap-3">
                      <div className="flex justify-between items-start">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <p className="font-mono text-gray-800 font-bold text-lg">{bike}</p>
                            {details?.battery !== undefined && (
                              <div className="flex items-center justify-center w-8 h-8 rounded-full border-2 border-blue-500 text-[9px] font-bold text-blue-600 bg-white shadow-sm">{formatBattery(details.battery)}%</div>
                            )}
                            {renderConflictIcon(bike)}
                            {moved > 10 && (
                              <div className="flex items-center gap-0.5 text-orange-500 animate-pulse">
                                <MovingIcon className="w-3.5 h-3.5"/>
                                {moved > 100 && <MovingIcon className="w-3.5 h-3.5"/>}
                                <span className="text-[10px] font-bold uppercase ml-1">Movendo ({moved > 1000 ? `${(moved/1000).toFixed(1)}km` : `${moved.toFixed(0)}m`})</span>
                              </div>
                            )}
                          </div>
                          {dist !== null && (
                            <span className="text-[10px] font-bold text-blue-600">
                              {routeDistances[bike] ? `${routeDistances[bike].distance} · ${routeDistances[bike].duration}` : `${dist.toFixed(2)} km`}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 w-full">
                        <button onClick={() => handleNaoAtendidaClick(bike)} disabled={isLoading || processingBikes.has(bike)}
                          className="flex-1 px-2 py-2 bg-yellow-500 text-white rounded-md hover:bg-yellow-600 active:scale-95 disabled:bg-gray-400 text-[10px] font-bold uppercase">Não Atendida</button>
                        <button onClick={() => handleSearch(bike)} disabled={isLoading || processingBikes.has(bike)}
                          className="flex-1 px-2 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 active:scale-95 disabled:bg-gray-400 text-[10px] font-bold uppercase">Recolher</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="text-sm text-gray-500">Nenhuma bicicleta no seu roteiro no momento.</p>}
          </div>
        )}

        {/* BIKES RECOLHIDAS */}
        {!isAdm && !isMecanica && (
          <div className="mt-6 p-4 border rounded-lg bg-gray-50">
            <h2 className="text-lg font-semibold text-gray-700 mb-3">Bikes Recolhidas</h2>
            {sortedCollectedBikes.length > 0 ? (
              <ul className="space-y-2">
                {sortedCollectedBikes.map(bike => (
                  <li key={bike} className="p-3 bg-white border rounded-md flex flex-col sm:flex-row justify-between items-center gap-2">
                    <div className="flex items-center gap-3">
                      <p className="font-mono text-gray-800 font-bold text-lg">{bike}</p>
                      {collectedBikesDetails[bike]?.battery !== undefined && (
                        <div className="flex items-center justify-center w-10 h-10 rounded-full border-2 border-blue-500 text-[10px] font-bold text-blue-600 bg-white shadow-sm">{formatBattery(collectedBikesDetails[bike].battery)}%</div>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2 w-full max-w-[240px]">
                      <button onClick={() => handleCollectedBikeAction(bike, 'Enviada para Estação')} disabled={isLoading || processingBikes.has(bike)} className="px-2 py-1 bg-blue-500 text-white rounded-md hover:bg-blue-600 active:scale-95 text-xs disabled:bg-gray-400">Estação</button>
                      <button onClick={() => handleCollectedBikeAction(bike, 'Enviada para Filial')} disabled={isLoading || processingBikes.has(bike)} className="px-2 py-1 bg-green-500 text-white rounded-md hover:bg-green-600 active:scale-95 text-xs disabled:bg-gray-400">Filial</button>
                      <button onClick={() => handleCollectedBikeAction(bike, 'Vandalizada')} disabled={isLoading || processingBikes.has(bike)} className="px-2 py-1 bg-red-500 text-white rounded-md hover:bg-red-600 active:scale-95 text-xs disabled:bg-gray-400">Vandalizada</button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-gray-500">Nenhuma bicicleta recolhida ainda.</p>}
          </div>
        )}
      </main>

      {/* MODAIS */}
      <RequestModal isOpen={isRequestModalOpen} onClose={() => setRequestModalOpen(false)} onSubmit={handleCreateRequest} isLoading={isLoading} motoristas={motoristas} driverLocations={driverLocations} error={error} clearError={() => setError(null)}/>
      <EditDriverModal isOpen={isEditDriverModalOpen} onClose={() => setIsEditDriverModalOpen(false)} driver={editingDriver} onSave={handleUpdateDriverState} isLoading={isLoading}/>
      <RouteModal isOpen={isRouteModalOpen} onClose={() => setRouteModalOpen(false)} onSubmit={handleCreateRoute} isLoading={isLoading} pendingBikeNumbers={allActiveBikes} motoristas={motoristas} error={error} clearError={() => setError(null)} type="route"/>
      <RouteModal isOpen={isTrailerModalOpen} onClose={() => setTrailerModalOpen(false)} onSubmit={handleCreateTrailer} isLoading={isLoading} pendingBikeNumbers={allActiveBikes} motoristas={motoristas} error={error} clearError={() => setError(null)} type="trailer"/>
      <ReportModal isOpen={isReportModalOpen} onClose={() => setReportModalOpen(false)} driverName={driverName} plate={plate} kmInicial={kmInicial}/>
      <DestinationModal isOpen={destinationModal.isOpen} onClose={() => setDestinationModal(prev => ({ ...prev, isOpen: false }))}
        onConfirm={obs => executeCollectedBikeAction(destinationModal.bikeNumber, destinationModal.type === 'Estação' ? 'Enviada para Estação' : destinationModal.type === 'Filial' ? 'Enviada para Filial' : 'Vandalizada', obs)}
        type={destinationModal.type} bikeNumber={destinationModal.bikeNumber} stationName={destinationModal.stationName} isLoading={isLoading} onRecalculate={recalculateStation}/>
      <HistoryModal isOpen={isHistoryModalOpen} onClose={() => setIsHistoryModalOpen(false)} history={requestsHistory} isLoading={isHistoryLoading} driverName={driverName}/>
      <ScheduleModal isOpen={isScheduleModalOpen} onClose={() => setIsScheduleModalOpen(false)} schedule={userSchedule} driverName={driverName} isLoading={isScheduleLoading}/>
      <VehicleSwitchModal isOpen={isVehicleModalOpen} onClose={() => setIsVehicleModalOpen(false)} onSwitch={(p, km) => onUpdateUser({ plate: p, kmInicial: km })} driverName={driverName}/>
      <AdminAlerts isOpen={isAdminAlertsOpen} onClose={() => setIsAdminAlertsOpen(false)} adminName={driverName}/>
      <ReporModal isOpen={isReporModalOpen} onClose={() => setIsReporModalOpen(false)} data={reporData} isLoading={isReporLoading}/>
      <MechanicRepairModal isOpen={isMechanicRepairModalOpen} onClose={() => setIsMechanicRepairModalOpen(false)} onConfirm={handleFinalizeMechanicsRepair} isLoading={isLoading} bikeNumber={selectedMechanicBike?.patrimonio || ''}/>
      <MechanicSelectionModal isOpen={isMechanicSelectionModalOpen} onClose={() => setIsMechanicSelectionModalOpen(false)} onConfirm={handleMechanicSelectionConfirm} isLoading={isLoading} bikeNumber={selectedMechanicBike?.patrimonio || ''}/>
      <TrailerSelectionModal isOpen={isTrailerSelectionModalOpen} onClose={() => setIsTrailerSelectionModalOpen(false)}
        onConfirm={name => { handleOrganizeTrailer(selectedBikesForTrailer, name); setIsTrailerSelectionModalOpen(false); }}
        isLoading={isLoading} bikeNumbers={selectedBikesForTrailer}/>
    </div>
  );
};

export default MainScreen;
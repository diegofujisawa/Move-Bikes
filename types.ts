
export enum BikeStatus {
  Recolhida = 'Recolhida',
  NaoEncontrada = 'Não encontrada',
  NaoAtendida = 'Não atendida',
}

export enum FinalStatus {
  RemanejadaEstacao = 'Remanejada para Estação',
  RemanejadaFilial = 'Remanejada para Filial',
  Vandalizada = 'Vandalizada',
}

export interface User {
  name: string;
  category: 'MOTORISTA' | 'ADM' | string; // string for flexibility
}

export interface BicycleData {
  id: number | string;
  localizacao: string;
  status: string;
  usuario: string;
  bateria: string;
  trava: string;
  carregamento: string;
  ultima_informacao: string;
  latitude: number | string;
  longitude: number | string;
  [key: string]: any; 
}

/**
 * A estrutura do payload foi alterada para um método mais robusto.
 * Em vez de chaves baseadas nos nomes das colunas, enviamos um array 'rowData'
 * com os valores na ordem exata das colunas da planilha.
 * Isso evita problemas com caracteres especiais ou nomes de colunas.
 */
export interface ReportPayload {
  action: 'logReport';
  rowData: (string | null)[];
}

export interface PickupRequest {
  id: string; // ID único da solicitação (ex: linha da planilha)
  bikeNumber: string;
  timestamp: string;
  status: string; // Alterado para string para maior flexibilidade
  location: string; // Localização informada pelo solicitante
  reason: string; // Motivo informado pelo solicitante
  acceptedBy?: string; // Nome do motorista que aceitou
  recipient?: string; // Para quem a notificação é destinada
  bikeData?: BicycleData; 
}

export interface PickupRequest {
  id: string; // ID único da solicitação (ex: linha da planilha)
  bikeNumber: string;
  timestamp: string;
  status: string; // Alterado para string para maior flexibilidade
  location: string; // Localização informada pelo solicitante
  reason: string; // Motivo informado pelo solicitante
  acceptedBy?: string; // Nome do motorista que aceitou
  recipient?: string; // Para quem a notificação é destinada
  bikeData?: BicycleData; 
}

export interface DailyActivity {
  date: string;
  remanejadasEstacao: { bikeId: string; station: string; region: string }[];
  remanejadasFilial: string[];
  vandalizadas: string[];
  naoEncontradas: string[];
  ocorrencias: { bikeId: string; obs: string }[];
}

export interface Station {
  name: string;
  latitude: number;
  longitude: number;
  region: string;
  Occupancy?: string;
}

export interface DriverLocation {
    driverName: string;
    latitude: number;
    longitude: number;
    timestamp: string;
}
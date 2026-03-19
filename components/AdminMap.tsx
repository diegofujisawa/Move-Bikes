import React, { useState, useEffect, useRef, useCallback } from 'react';
import { LogoutIcon, MapIcon, XIcon, MovingIcon } from './icons';
import { DriverLocation } from '../types';
import { db } from '../firebase';
import { collection, onSnapshot, query } from 'firebase/firestore';
import L from 'leaflet';

// Fix for default marker icons in Leaflet
import 'leaflet/dist/leaflet.css';

interface AdminMapProps {
  adminName: string;
  onLogout: () => void;
  onClose: () => void;
}

const normalizeCoord = (coord: number): number => {
    if (isNaN(coord) || coord === null) return coord;
    let val = coord;
    if (Math.abs(val) > 1000) {
        while (Math.abs(val) > 180) {
            val /= 10;
        }
    }
    return val;
};

const AdminMap: React.FC<AdminMapProps> = ({ onLogout, onClose }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<{ [key: string]: L.Marker }>({});
  const hasCenteredRef = useRef(false);
  
  const updateMapWithLocations = useCallback((locations: DriverLocation[]) => {
    if (!mapContainerRef.current) return;

    // Inicializa o mapa apenas uma vez usando Leaflet (GRATUITO)
    if (!mapRef.current) {
        const map = L.map(mapContainerRef.current, {
            center: [-23.1791, -45.8872], // Coordenadas do centro de São José dos Campos
            zoom: 12,
            zoomControl: true,
            attributionControl: true
        });

        // Adiciona os tiles do OpenStreetMap (Gratuito e sem limite de uso)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        mapRef.current = map;
    }

    if (mapRef.current) {
        const map = mapRef.current;
        const currentMarkers = markersRef.current;
        const activeDrivers = new Set<string>();
        const markerGroup: L.LatLng[] = [];

        locations.forEach(loc => {
            const { driverName, latitude, longitude } = loc;
            const normLat = normalizeCoord(latitude);
            const normLng = normalizeCoord(longitude);
            
            if (isNaN(normLat) || isNaN(normLng) || normLat === 0 || normLng === 0) return;

            const position = L.latLng(normLat, normLng);
            activeDrivers.add(driverName);
            markerGroup.push(position);

            if (currentMarkers[driverName]) {
                currentMarkers[driverName].setLatLng(position);
            } else {
                const marker = L.marker(position, {
                    title: driverName,
                }).addTo(map);

                marker.bindTooltip(driverName, { 
                    permanent: true, 
                    direction: 'top',
                    className: 'bg-blue-600 text-white font-bold px-2 py-1 rounded shadow-lg border-none'
                });

                currentMarkers[driverName] = marker;
            }
        });

        // Centraliza automaticamente na primeira vez que houver motoristas
        if (markerGroup.length > 0 && !hasCenteredRef.current) {
            const bounds = L.latLngBounds(markerGroup);
            map.fitBounds(bounds, { padding: [70, 70] });
            hasCenteredRef.current = true;
        }

        Object.keys(currentMarkers).forEach(driverName => {
            if (!activeDrivers.has(driverName)) {
                map.removeLayer(currentMarkers[driverName]);
                delete currentMarkers[driverName];
            }
        });
    }
  }, []);

  const handleRecenter = useCallback(() => {
    if (mapRef.current && markersRef.current) {
      const markerGroup: L.LatLng[] = Object.values(markersRef.current).map(m => m.getLatLng());
      if (markerGroup.length > 0) {
        const bounds = L.latLngBounds(markerGroup);
        mapRef.current.fitBounds(bounds, { padding: [70, 70] });
      }
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    
    // Escuta a coleção de usuários no Firestore para obter localizações em tempo real
    const q = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const locations: DriverLocation[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.gps && data.gps.lat && data.gps.lng) {
          locations.push({
            driverName: data.login || doc.id,
            latitude: data.gps.lat,
            longitude: data.gps.lng,
            timestamp: data.gps.timestamp || ''
          });
        }
      });
      
      updateMapWithLocations(locations);
      setIsLoading(false);
      setError(null);
    }, (err) => {
      console.error("Erro ao escutar localizações:", err);
      setError("Erro ao conectar com o banco de dados em tempo real.");
      setIsLoading(false);
    });

    return () => {
      unsubscribe();
      if (mapRef.current) {
          mapRef.current.remove();
          mapRef.current = null;
      }
      markersRef.current = {};
    };
  }, [updateMapWithLocations]);

  return (
    <div className="bg-white p-6 rounded-xl shadow-lg w-full h-full flex flex-col">
      <header className="flex justify-between items-center mb-4 pb-4 border-b flex-shrink-0">
        <div className="flex items-center gap-3">
          <MapIcon className="w-6 h-6 text-blue-600"/>
          <h2 className="font-semibold text-gray-700">Mapa de Motoristas (OpenStreetMap - Gratuito)</h2>
        </div>
        <div className="flex items-center gap-2">
            <button 
                onClick={handleRecenter} 
                title="Centralizar Motoristas" 
                className="flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors font-medium text-sm"
            >
                <MovingIcon className="w-4 h-4" />
                <span>Centralizar</span>
            </button>
            <button onClick={onClose} title="Fechar Mapa" className="p-2 rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors">
                <XIcon className="w-5 h-5" />
            </button>
            <button onClick={onLogout} title="Sair" className="p-2 rounded-full text-gray-500 hover:bg-gray-100 hover:text-red-600 transition-colors">
                <LogoutIcon className="w-5 h-5" />
            </button>
        </div>
      </header>
      <main className="flex-grow relative bg-gray-100 rounded-md overflow-hidden">
        <div id="map-container" ref={mapContainerRef} className="w-full h-full z-0"></div>
        
        {(isLoading || error) && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100/50 backdrop-blur-sm z-10">
                <div className="bg-white p-6 rounded-lg shadow-2xl text-center">
                    {isLoading && (
                        <div className="flex items-center gap-3 text-gray-600">
                            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                            <span>Carregando mapa gratuito...</span>
                        </div>
                    )}
                    {error && <p className="text-red-600 font-semibold">{error}</p>}
                </div>
            </div>
        )}
      </main>
    </div>
  );
};

export default AdminMap;

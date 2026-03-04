import React, { useState, useEffect, useRef, useCallback } from 'react';
import { LogoutIcon, MapIcon, XIcon } from './icons';
import { DriverLocation } from '../types';
import { apiGetCall } from '../api';

// Declara o namespace 'google' para que o TypeScript o reconheça.
declare const google: any;

interface AdminMapProps {
  adminName: string;
  onLogout: () => void;
  onClose: () => void;
}

const AdminMap: React.FC<AdminMapProps> = ({ onLogout, onClose }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mapRef = useRef<any>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<{ [key: string]: any }>({});
  
  const fetchLocationsAndUpdateMap = useCallback(async () => {
    try {
      // ATUALIZAÇÃO: Trocado para apiGetCall para maior compatibilidade com diferentes plataformas (como Netlify).
      const result = await apiGetCall('getDriverLocations');
      const locations = (result.data || []) as DriverLocation[];
      setError(null);
      
      if (typeof google === 'undefined' || typeof google.maps === 'undefined') {
          // Se o Google Maps ainda não carregou, não lançamos erro imediatamente, 
          // apenas aguardamos a próxima execução do intervalo.
          console.warn("Aguardando carregamento da API do Google Maps...");
          return;
      }

      // Inicializa o mapa apenas uma vez. O `mapId` foi removido, pois não é 
      // necessário para os marcadores clássicos e era uma fonte de problemas.
      if (mapContainerRef.current && !mapRef.current) {
          const map = new google.maps.Map(mapContainerRef.current, {
              center: { lat: -23.1791, lng: -45.8872 }, // Coordenadas do centro de São José dos Campos
              zoom: 12,
              disableDefaultUI: true,
              zoomControl: true,
              streetViewControl: true,
              fullscreenControl: true,
          });
          mapRef.current = map;
      }

      if (mapRef.current) {
          const currentMarkers = markersRef.current;
          const activeDrivers = new Set<string>();
          const bounds = new google.maps.LatLngBounds();
          let hasLocations = false;

          locations.forEach(loc => {
              const { driverName, latitude, longitude } = loc;
              const position = { lat: latitude, lng: longitude };
              activeDrivers.add(driverName);
              hasLocations = true;
              bounds.extend(position);

              if (currentMarkers[driverName]) {
                  // Atualiza a posição usando o método `setPosition`, padrão da API clássica.
                  currentMarkers[driverName].setPosition(position);
              } else {
                  // Cria um novo `google.maps.Marker` (clássico), que é mais robusto.
                  // Substituímos o HTML complexo por um ícone e um rótulo, que é mais performático.
                  currentMarkers[driverName] = new google.maps.Marker({
                      position,
                      map: mapRef.current,
                      title: driverName,
                      label: {
                          text: driverName,
                          color: '#FFFFFF', // Cor do texto branca
                          fontWeight: 'bold',
                          className: 'marker-label' // Classe CSS para adicionar sombra
                      },
                      icon: {
                          path: google.maps.SymbolPath.CIRCLE,
                          scale: 10,
                          fillColor: '#2563EB', // Azul
                          fillOpacity: 1,
                          strokeColor: '#FFFFFF',
                          strokeWeight: 2,
                      },
                  });
              }
          });

          // Ajusta o zoom para mostrar todos os motoristas apenas na primeira carga bem-sucedida
          if (hasLocations && isLoading) {
              mapRef.current.fitBounds(bounds);
              // Se houver apenas um motorista, o fitBounds pode dar um zoom muito alto
              if (locations.length === 1) {
                  google.maps.event.addListenerOnce(mapRef.current, 'bounds_changed', () => {
                      if (mapRef.current.getZoom() > 15) mapRef.current.setZoom(15);
                  });
              }
          }

          // Remove marcadores de motoristas que ficaram offline usando `setMap(null)`.
          Object.keys(currentMarkers).forEach(driverName => {
              if (!activeDrivers.has(driverName)) {
                  currentMarkers[driverName].setMap(null);
                  delete currentMarkers[driverName];
              }
          });
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ocorreu um erro ao buscar localizações.');
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    
    const runProcess = async () => {
      await fetchLocationsAndUpdateMap();
      if (isMounted) {
        setIsLoading(false);
      }
    };

    runProcess();
    
    const intervalId = setInterval(fetchLocationsAndUpdateMap, 10000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
      // Limpa os marcadores do mapa ao desmontar o componente
      if (markersRef.current) {
          Object.values(markersRef.current).forEach(marker => {
              if (marker && typeof marker.setMap === 'function') {
                  marker.setMap(null);
              }
          });
          markersRef.current = {};
      }
      mapRef.current = null;
    };
  }, [fetchLocationsAndUpdateMap]);

  return (
    <div className="bg-white p-6 rounded-xl shadow-lg w-full h-full flex flex-col">
      <header className="flex justify-between items-center mb-4 pb-4 border-b flex-shrink-0">
        <div className="flex items-center gap-3">
          <MapIcon className="w-6 h-6 text-blue-600"/>
          <h2 className="font-semibold text-gray-700">Mapa de Motoristas em Tempo Real</h2>
        </div>
        <div className="flex items-center gap-2">
            <button onClick={onClose} title="Fechar Mapa" className="p-2 rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors">
                <XIcon className="w-5 h-5" />
            </button>
            <button onClick={onLogout} title="Sair" className="p-2 rounded-full text-gray-500 hover:bg-gray-100 hover:text-red-600 transition-colors">
                <LogoutIcon className="w-5 h-5" />
            </button>
        </div>
      </header>
      <main className="flex-grow relative bg-gray-100 rounded-md overflow-hidden">
        <div id="map-container" ref={mapContainerRef} className="w-full h-full"></div>
        
        {(isLoading || error) && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100/50 backdrop-blur-sm z-10">
                <div className="bg-white p-6 rounded-lg shadow-2xl text-center">
                    {isLoading && (
                        <div className="flex items-center gap-3 text-gray-600">
                            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                            <span>Carregando mapa e motoristas...</span>
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
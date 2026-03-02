import React, { useState, useEffect, useRef } from 'react';
// O ícone `PlusPlusIcon` representa a criação de um roteiro (múltiplas solicitações).
import { PlusPlusIcon } from './icons';

interface RouteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (details: { routeName: string; bikeNumbers: string[]; recipient: string; }) => void;
  isLoading: boolean;
  pendingBikeNumbers: Set<string>;
  motoristas: string[];
  error: string | null;
  clearError: () => void;
}

// Hook customizado para obter o valor anterior de uma prop ou estado.
function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}

const RouteModal: React.FC<RouteModalProps> = ({ isOpen, onClose, onSubmit, isLoading, pendingBikeNumbers, motoristas, error, clearError }) => {
  const [routeName, setRouteName] = useState('');
  const [bikeListText, setBikeListText] = useState('');
  const [recipient, setRecipient] = useState('Todos');

  const prevIsOpen = usePrevious(isOpen);

  // Efeito para limpar o formulário sempre que o modal for fechado.
  // Isso garante que ele esteja sempre limpo ao ser reaberto e previne erros de estado.
  useEffect(() => {
    if (!isOpen && prevIsOpen) {
      setRouteName('');
      setBikeListText('');
      setRecipient('Todos');
    }
  }, [isOpen, prevIsOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (bikeListText.trim() && routeName.trim()) {
      const numbers = [...new Set(
        bikeListText
          .split(/[\s,;\n]+/)
          .map(num => num.trim())
          .filter(Boolean)
      )];
      
      if (numbers.length > 0) {
        const conflictingBikes = numbers.filter(num => pendingBikeNumbers.has(num));
        
        if (conflictingBikes.length > 0) {
          const proceed = window.confirm(
            `Atenção! As seguintes bicicletas já constam em outras solicitações pendentes:\n\n${conflictingBikes.join(', ')}\n\nDeseja continuar e criar a rota mesmo assim?`
          );
          if (!proceed) {
            return; // Interrompe a submissão
          }
        }
        
        onSubmit({ routeName, bikeNumbers: numbers, recipient });
      }
    }
  };
  
  const canSubmit = bikeListText.trim().length > 0 && routeName.trim().length > 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-white p-6 rounded-xl shadow-lg w-full max-w-sm relative">
        <div className="flex flex-col items-center mb-4">
          <PlusPlusIcon className="w-12 h-12 text-blue-600" />
          <h2 className="text-xl font-bold text-gray-800 mt-2">Enviar Roteiro para Motorista</h2>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="route-name" className="block text-sm font-medium text-gray-700">
              Nome da Rota
            </label>
            <input
              id="route-name"
              type="text"
              value={routeName}
              onChange={(e) => { if (error) clearError(); setRouteName(e.target.value); }}
              className="mt-1 block w-full p-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
              placeholder="Ex: Rota Copacabana"
              required
            />
          </div>
          <div>
            <label htmlFor="route-bike-list" className="block text-sm font-medium text-gray-700">
              Números das Bicicletas
            </label>
            <p className="text-xs text-gray-500 mb-2">Cole ou digite os números, separados por espaço, vírgula ou quebra de linha.</p>
            <textarea 
              id="route-bike-list" 
              value={bikeListText} 
              onChange={(e) => { if (error) clearError(); setBikeListText(e.target.value); }}
              rows={4} 
              className="mt-1 block w-full p-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" 
              placeholder="580, 581, 582..." 
              required 
            />
          </div>
           <div>
            <label htmlFor="route-recipient" className="block text-sm font-medium text-gray-700">Notificar Motorista</label>
            <select 
              id="route-recipient"
              value={recipient}
              onChange={(e) => { if (error) clearError(); setRecipient(e.target.value); }}
              className="mt-1 block w-full p-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="Todos">Todos</option>
              {motoristas.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
          {error && (
            <div className="text-red-600 bg-red-100 p-3 rounded-md text-sm my-2 text-center">
              {error}
            </div>
          )}
          <div className="flex items-center gap-3 pt-2">
            <button
                type="button"
                onClick={onClose}
                disabled={isLoading}
                className="w-full flex justify-center py-3 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400 disabled:opacity-50"
            >
                Cancelar
            </button>
            <button
                type="submit"
                disabled={!canSubmit || isLoading}
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:bg-gray-400"
            >
                {isLoading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : 'Enviar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RouteModal;

import React from 'react';
import { XIcon, TrailerIcon } from './icons';

interface TrailerSelectionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (trailerName: string) => void;
    isLoading: boolean;
    bikeNumbers: string[];
}

const TrailerSelectionModal: React.FC<TrailerSelectionModalProps> = ({ isOpen, onClose, onConfirm, isLoading, bikeNumbers }) => {
    const trailers = ["Carretinha 1", "Carretinha 2", "Carretinha 3", "Carretinha 4", "Carretinha 5"];
    const [selected, setSelected] = React.useState('');

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50 animate-fade-in">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
                <div className="bg-blue-600 p-4 flex justify-between items-center text-white">
                    <h2 className="font-bold text-lg">Organizar Carretinha</h2>
                    <button onClick={onClose} className="p-1 hover:bg-blue-700 rounded-full transition-colors">
                        <XIcon className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <p className="text-sm font-bold text-gray-700 mb-3 uppercase">Selecione a Carretinha:</p>
                        <div className="grid grid-cols-2 gap-2">
                            {trailers.map(name => (
                                <button
                                    key={name}
                                    onClick={() => setSelected(name)}
                                    className={`flex flex-col items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all ${
                                        selected === name 
                                        ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm' 
                                        : 'border-gray-100 hover:border-gray-200 text-gray-700 bg-gray-50'
                                    }`}
                                >
                                    <TrailerIcon className={`w-6 h-6 ${selected === name ? 'text-blue-600' : 'text-gray-400'}`} />
                                    <span className="font-bold text-sm">{name}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="pt-2">
                        <p className="text-xs font-bold text-gray-500 mb-2 uppercase">Bikes Selecionadas ({bikeNumbers.length}):</p>
                        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-2 bg-gray-50 rounded border border-gray-100">
                            {bikeNumbers.map(num => (
                                <span key={num} className="px-2 py-0.5 bg-white border border-gray-200 rounded text-[10px] font-bold text-gray-600">
                                    {num}
                                </span>
                            ))}
                        </div>
                    </div>

                    <div className="flex gap-3 pt-4">
                        <button 
                            onClick={onClose}
                            disabled={isLoading}
                            className="flex-1 py-2.5 border border-gray-300 rounded-md text-sm font-bold text-gray-600 hover:bg-gray-50 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button 
                            onClick={() => onConfirm(selected)}
                            disabled={isLoading || !selected}
                            className="flex-1 py-2.5 bg-blue-600 text-white rounded-md text-sm font-bold hover:bg-blue-700 transition-colors shadow-md disabled:bg-gray-400 flex items-center justify-center gap-2"
                        >
                            {isLoading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
                            Confirmar
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TrailerSelectionModal;

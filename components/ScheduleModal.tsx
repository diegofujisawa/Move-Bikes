import React from 'react';
import { XIcon } from './icons';

interface ScheduleModalProps {
    isOpen: boolean;
    onClose: () => void;
    schedule: Record<string, string>;
    driverName: string;
}

const ScheduleModal: React.FC<ScheduleModalProps> = ({ isOpen, onClose, schedule, driverName }) => {
    if (!isOpen) return null;

    const getDayOrder = (day: string): number => {
        const upper = day.trim().toUpperCase();
        if (upper.includes('DOMINGO')) return 7;
        if (upper.includes('SEGUNDA')) return 1;
        if (upper.includes('TERÇA') || upper.includes('TERCA')) return 2;
        if (upper.includes('QUARTA')) return 3;
        if (upper.includes('QUINTA')) return 4;
        if (upper.includes('SEXTA')) return 5;
        if (upper.includes('SABADO') || upper.includes('SÁBADO')) return 6;
        return 99;
    };

    // Ordenar as datas (assumindo formato DD/MM/YYYY ou nomes de dias da semana)
    const sortedDates = Object.keys(schedule).sort((a, b) => {
        const orderA = getDayOrder(a);
        const orderB = getDayOrder(b);

        // Se ambos forem dias da semana conhecidos
        if (orderA !== 99 && orderB !== 99) {
            return orderA - orderB;
        }

        // Tentar ordenar por data DD/MM/YYYY
        const partsA = a.split('/');
        const partsB = b.split('/');
        
        if (partsA.length >= 2 && partsB.length >= 2) {
            try {
                const dayA = parseInt(partsA[0], 10);
                const monthA = parseInt(partsA[1], 10) - 1;
                const yearA = partsA.length === 3 ? parseInt(partsA[2], 10) : new Date().getFullYear();
                
                const dayB = parseInt(partsB[0], 10);
                const monthB = parseInt(partsB[1], 10) - 1;
                const yearB = partsB.length === 3 ? parseInt(partsB[2], 10) : new Date().getFullYear();

                const dateA = new Date(yearA, monthA, dayA);
                const dateB = new Date(yearB, monthB, dayB);
                
                if (!isNaN(dateA.getTime()) && !isNaN(dateB.getTime())) {
                    return dateA.getTime() - dateB.getTime();
                }
            } catch {
                // Fallback to string compare
            }
        }
        
        // Se um for dia da semana e outro data, prioriza o que vier primeiro na lógica de negócio
        // Aqui vamos apenas usar localeCompare como último recurso
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in-up">
                <div className="p-4 border-b flex justify-between items-center bg-blue-600 text-white">
                    <h2 className="text-lg font-bold">Minha Escala - {driverName}</h2>
                    <button onClick={onClose} className="p-1 hover:bg-blue-700 rounded-full transition-colors">
                        <XIcon className="w-6 h-6" />
                    </button>
                </div>
                
                <div className="p-4 max-h-[70vh] overflow-y-auto">
                    {sortedDates.length > 0 ? (
                        <div className="space-y-2">
                            {sortedDates.map(date => (
                                <div key={date} className="flex justify-between items-center p-3 border rounded-lg hover:bg-gray-50 transition-colors">
                                    <span className="font-medium text-gray-700">{date}</span>
                                    <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${
                                        (schedule[date] || '').toLowerCase().includes('folga') 
                                        ? 'bg-green-100 text-green-700' 
                                        : 'bg-blue-100 text-blue-700'
                                    }`}>
                                        {schedule[date]}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-center text-gray-500 py-8">Nenhuma escala encontrada para você.</p>
                    )}
                </div>
                
                <div className="p-4 border-t bg-gray-50 flex justify-end">
                    <button 
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                    >
                        Fechar
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ScheduleModal;

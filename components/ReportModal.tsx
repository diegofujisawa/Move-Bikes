
import React, { useState, useEffect } from 'react';
import { DailyActivity } from '../types';
import { DocumentTextIcon } from './icons';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  driverName: string;
  kmInicial?: number;
  activity: DailyActivity;
}

import { apiCall } from '../api';

const ReportModal: React.FC<ReportModalProps> = ({ isOpen, onClose, driverName, kmInicial }) => {
  const [reportText, setReportText] = useState('Gerando relatório...');
  const [copyButtonText, setCopyButtonText] = useState('Copiar');
  const [kmFinal, setKmFinal] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reportData, setReportData] = useState<any>(null);

  const fetchAndGenerateReport = async () => {
    setReportText('Gerando relatório...');
    try {
      const result = await apiCall({ action: 'getDailyReportData', driverName });
      if (result.success && result.data) {
        const data = result.data;
        setReportData(data);
        const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });

        const formatList = (list?: string[]) => (list && list.length > 0) ? list.join(', ') : 'Nenhuma';
        const formatMultilineList = (list?: string[]) => (list && list.length > 0) ? list.join('\n') : 'Nenhuma';

        // Calcula KM rodado total (incluindo a sessão atual se o KM Final foi digitado)
        let totalKm = data.totalKmRodado || 0;
        const kmFinalNum = parseFloat(kmFinal) || 0;
        if (kmFinalNum > 0 && kmInicial !== undefined) {
          const currentDiff = kmFinalNum - kmInicial;
          if (currentDiff > 0) {
            totalKm += currentDiff;
          }
        }

        const plates = Array.from(new Set([...(data.platesUsed || [])]));
        const platesStr = plates.length > 0 ? plates.join(' / ') : 'N/A';

        const formatTime = (dateStr: string | null) => {
          if (!dateStr) return '--:--';
          const d = new Date(dateStr);
          return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        };

        const report = `📋 *RELATÓRIO DIÁRIO DE JORNADA*
📅 *Data:* ${today}
👤 *Motorista:* ${driverName}
🚗 *Veículo (Placa):* ${platesStr}
🛣️ *KM Total Rodado:* ${totalKm.toFixed(1)} km
⏰ *Horário:* ${formatTime(data.startTime)} às ${formatTime(data.endTime)}

---
📊 *RESUMO DE ATIVIDADES*
🔋 *Bikes Recolhidas (Bateria Baixa):* ${data.counts?.bateriaBaixa || 0}
🚲 *Manutenção Bicicleta:* ${data.counts?.manutencaoBicicleta || 0}
🔒 *Manutenção Locker:* ${data.counts?.manutencaoLocker || 0}
🚉 *Bikes Remanejadas (Estação):* ${data.remanejadas?.length || 0}
⚠️ *Ocorrências Atendidas:* ${data.ocorrencias?.length || 0}
🔍 *Bikes Não Encontradas:* ${data.naoEncontrada?.length || 0}
❌ *Bikes Vandalizadas:* ${data.vandalizadas?.length || 0}

---
📝 *DETALHAMENTO*
✅ *Recolhidas (Filial):* ${formatList(data.recolhidas)}
✅ *Remanejadas (Estação):* ${formatList(data.remanejadas)}
📍 *Estações Abastecidas:*
${Object.entries(data.estacoes || {}).map(([name, count]) => `• ${name}: ${count} bike(s)`).join('\n') || 'Nenhuma'}

⚠️ *Ocorrências:* ${formatMultilineList(data.ocorrencias)}
❌ *Vandalizadas:* ${formatList(data.vandalizadas)}

---
💬 *OBSERVAÇÕES:*
`;
        setReportText(report.trim());
      } else {
        setReportText(`Erro ao gerar relatório: ${result.error || 'Erro desconhecido.'}`);
      }
    } catch (err: any) {
      setReportText(`Erro de comunicação: ${err.message}`);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchAndGenerateReport();
      setCopyButtonText('Copiar');
    }
  }, [isOpen, driverName, kmFinal, kmInicial]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    if (!kmFinal) {
      alert("Por favor, insira o KM Final antes de copiar o relatório.");
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Calcula KM total final
      let totalKm = reportData?.totalKmRodado || 0;
      const kmFinalNum = parseFloat(kmFinal) || 0;
      if (kmFinalNum > 0 && kmInicial !== undefined) {
        const currentDiff = kmFinalNum - kmInicial;
        if (currentDiff > 0) totalKm += currentDiff;
      }

      // 2. Salva o resumo diário na nova aba
      await apiCall({
        action: 'saveDailySummary',
        summaryData: {
          driverName,
          plates: reportData?.platesUsed?.join(' / ') || 'N/A',
          totalKm,
          bateriaCount: reportData?.counts?.bateriaBaixa || 0,
          manutBikeCount: reportData?.counts?.manutencaoBicicleta || 0,
          manutLockerCount: reportData?.counts?.manutencaoLocker || 0,
          remanejadasCount: reportData?.remanejadas?.length || 0,
          ocorrenciasCount: reportData?.ocorrencias?.length || 0,
          naoEncontradasCount: reportData?.naoEncontrada?.length || 0,
          vandalizadasCount: reportData?.vandalizadas?.length || 0,
          startTime: reportData?.startTime,
          endTime: new Date().toISOString(), // O fim é agora
          obs: '' // Pode ser expandido se houver campo de obs
        }
      });

      // 3. Registra o FIM_TURNO no servidor (log individual)
      const result = await apiCall({ 
        action: 'logReport', 
        rowData: [new Date().toISOString(), 'SISTEMA', 'FIM_TURNO', `KM Final: ${kmFinal}`, driverName],
        kmFinal: parseFloat(kmFinal)
      });

      if (result.success) {
        navigator.clipboard.writeText(reportText);
        setCopyButtonText('Copiado!');
        
        // Após copiar, se o motorista quiser trocar de carro, ele precisará informar nova placa/KM.
        // Vamos emitir um evento ou chamar uma função para resetar o estado do veículo no MainScreen.
        setTimeout(() => {
          setCopyButtonText('Copiar');
          alert("Relatório copiado e KM Final registrado. Se for trocar de veículo, utilize a opção 'Trocar Veículo' no menu.");
          onClose();
        }, 1000);
      } else {
        alert("Erro ao salvar KM Final: " + result.error);
      }
    } catch (err: any) {
      alert("Erro de comunicação: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-white p-6 rounded-xl shadow-lg w-full max-w-lg relative max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 text-2xl font-bold">&times;</button>
        <div className="flex items-center mb-4">
          <DocumentTextIcon className="w-8 h-8 text-blue-600" />
          <h2 className="text-xl font-bold text-gray-800 ml-2">Relatório do Dia</h2>
        </div>

        <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
          <label htmlFor="kmFinal" className="block text-sm font-bold text-blue-800 mb-1">
            KM Final do Veículo
          </label>
          <input
            type="number"
            id="kmFinal"
            value={kmFinal}
            onChange={(e) => setKmFinal(e.target.value)}
            placeholder="Digite o KM final do odômetro"
            className="w-full p-2 border border-blue-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"
          />
          <p className="text-[10px] text-blue-600 mt-1 italic">Obrigatório para liberar a cópia do relatório.</p>
        </div>

        <textarea
          readOnly
          value={reportText}
          className="w-full h-64 p-3 border border-gray-300 rounded-md bg-gray-50 font-mono text-sm whitespace-pre-wrap"
        />
        <button
          onClick={handleCopy}
          disabled={!kmFinal || isSubmitting}
          className="mt-4 w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Salvando...' : copyButtonText}
        </button>
      </div>
    </div>
  );
};

export default ReportModal;
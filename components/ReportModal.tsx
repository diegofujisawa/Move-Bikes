
import React, { useState, useEffect } from 'react';
import { DailyActivity } from '../types';
import { DocumentTextIcon } from './icons';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  driverName: string;
  activity: DailyActivity;
}

import { apiCall } from '../api';

const ReportModal: React.FC<ReportModalProps> = ({ isOpen, onClose, driverName }) => {
  const [reportText, setReportText] = useState('Gerando relatório...');
  const [copyButtonText, setCopyButtonText] = useState('Copiar');

  useEffect(() => {
    if (isOpen) {
      const fetchAndGenerateReport = async () => {
        setReportText('Gerando relatório...');
        try {
          const result = await apiCall({ action: 'getDailyReportData', driverName });
          if (result.success && result.data) {
            const data = result.data;
            const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });

            const formatList = (list?: string[]) => (list && list.length > 0) ? list.join(', ') : 'Nenhuma';
            const formatMultilineList = (list?: string[]) => (list && list.length > 0) ? list.join('\n') : 'Nenhuma';

            const report = `Plantão ${driverName}
   ${today}
 ☑️ *Recolhidas e Remanejadas*
${formatList(data.remanejadas)}

☑️  *Remanejadas da filial*
${formatList(data.recolhidas)}

 ☑️ *Estações* 
${formatMultilineList(data.estacoes)}

 ☑️ *Ocorrência* 
${formatMultilineList(data.ocorrencias)}

 ☑️ *Não encontrada* 
${formatList(data.naoEncontrada)}

 ☑️ *Vandalizadas*
${formatList(data.vandalizadas)}

 ☑️ *Revisão*     
${formatList(data.revisao)}

 ☑️ *Locker* 
0

 ☑️  *OBS*
`;
            setReportText(report.trim());
          } else {
            setReportText(`Erro ao gerar relatório: ${result.error || 'Erro desconhecido.'}`);
          }
        } catch (err: any) {
          setReportText(`Erro de comunicação: ${err.message}`);
        }
      };

      fetchAndGenerateReport();
      setCopyButtonText('Copiar');
    }
  }, [isOpen, driverName]);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(reportText);
    setCopyButtonText('Copiado!');
    setTimeout(() => setCopyButtonText('Copiar'), 2000);
  };
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-white p-6 rounded-xl shadow-lg w-full max-w-lg relative">
        <button onClick={onClose} className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 text-2xl font-bold">&times;</button>
        <div className="flex items-center mb-4">
          <DocumentTextIcon className="w-8 h-8 text-blue-600" />
          <h2 className="text-xl font-bold text-gray-800 ml-2">Relatório do Dia</h2>
        </div>
        <textarea
          readOnly
          value={reportText}
          className="w-full h-80 p-3 border border-gray-300 rounded-md bg-gray-50 font-mono text-sm whitespace-pre-wrap"
        />
        <button
          onClick={handleCopy}
          className="mt-4 w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          {copyButtonText}
        </button>
      </div>
    </div>
  );
};

export default ReportModal;
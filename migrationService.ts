import { db } from './firebase';
import { collection, doc, writeBatch } from 'firebase/firestore';
import { apiCall } from './api';

export const migrateDataToFirebase = async (category: string) => {
  try {
    console.log('Iniciando exportação de dados do Google Sheets...');
    const result = await apiCall({ action: 'exportAllData', category });
    
    if (!result.success || !result.data) {
      throw new Error(result.error || 'Falha ao exportar dados.');
    }

    const bikes = Array.isArray(result.data.bikes) ? result.data.bikes : [];
    const users = Array.isArray(result.data.users) ? result.data.users : [];
    const requests = Array.isArray(result.data.requests) ? result.data.requests : [];

    console.log(`Dados recebidos: ${bikes.length} bikes, ${users.length} usuários, ${requests.length} requisições`);

    if (bikes.length > 0) {
      console.log('Migrando Bicicletas...');
      for (let i = 0; i < bikes.length; i += 500) {
        const batch = writeBatch(db);
        const chunk = bikes.slice(i, i + 500);
        chunk.forEach((bike: any) => {
          if (bike && bike['Patrimônio']) {
            const bikeRef = doc(db, 'bikes', String(bike['Patrimônio']));
            batch.set(bikeRef, {
              patrimonio: String(bike['Patrimônio']),
              modelo: bike['Modelo'] || '',
              status: bike['Status'] || '',
              localizacao: bike['Localidade'] || '',
              latitude: parseFloat(bike['Latitude']) || 0,
              longitude: parseFloat(bike['Longitude']) || 0,
              ultimaAtualizacao: bike['Última informação da posição'] || '',
              observacao: bike['Observação'] || '',
              situacao: bike['Situação'] || '',
              dataSituacao: bike['Data Situação'] || '',
              responsavel: bike['Usuário'] || ''
            });
          }
        });
        await batch.commit();
        console.log(`Bikes: ${Math.min(i + 500, bikes.length)}/${bikes.length}`);
      }
    }

    if (users.length > 0) {
      console.log('Migrando Usuários...');
      for (let i = 0; i < users.length; i += 500) {
        const batch = writeBatch(db);
        const chunk = users.slice(i, i + 500);
        chunk.forEach((user: any) => {
          if (user && user['Usuário']) {
            const userRef = doc(db, 'users', user['Usuário']);
            batch.set(userRef, {
              login: user['Usuário'],
              email: user['Email'] || '',
              category: user['Categoria'] || '',
              plate: user['Placa'] || '',
              lastKmFinal: parseFloat(user['KM Final']) || 0,
              gps: {
                lat: 0,
                lng: 0,
                timestamp: ''
              }
            }, { merge: true });
          }
        });
        await batch.commit();
        console.log(`Usuários: ${Math.min(i + 500, users.length)}/${users.length}`);
      }
    }

    if (requests.length > 0) {
      console.log('Migrando Solicitações...');
      for (let i = 0; i < requests.length; i += 500) {
        const batch = writeBatch(db);
        const chunk = requests.slice(i, i + 500);
        chunk.forEach((req: any) => {
          if (req && req['Patrimônio']) {
            const reqRef = doc(collection(db, 'requests'));
            batch.set(reqRef, {
              bikeNumber: String(req['Patrimônio']),
              location: req['Local'] || '',
              reason: req['Ocorrência'] || '',
              recipient: req['Destinatário'] || '',
              status: req['Status'] || 'Pendente',
              timestamp: req['Data/Hora'] || '',
              driverName: req['Motorista'] || ''
            });
          }
        });
        await batch.commit();
        console.log(`Requisições: ${Math.min(i + 500, requests.length)}/${requests.length}`);
      }
    }

    console.log('Migração concluída com sucesso!');
    return { success: true };
  } catch (error: any) {
    console.error('Erro na migração:', error);
    return { success: false, error: error.message };
  }
};

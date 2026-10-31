// npm start. Запуск сервера, печать адресов и кода комнаты;
// проверки Ollama, QR-коды и автономный режим добавляются в S4.

import os from 'node:os';
import { startServer, DEFAULT_CONFIG } from '../server/index.js';

const port = Number(process.env.PORT ?? DEFAULT_CONFIG.port);
const app = await startServer({ port, agents: { probeOnStart: true } });

console.log(`Сервер запущен: http://localhost:${port}`);
for (const list of Object.values(os.networkInterfaces())) {
  for (const iface of list ?? []) {
    if (iface.family === 'IPv4' && !iface.internal) console.log(`  в сети: http://${iface.address}:${port}`);
  }
}

console.log(`\n  Код комнаты: ${app.room.code}\n  (новый при каждом запуске; игроки вводят имя и этот код)\n`);

const stop = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

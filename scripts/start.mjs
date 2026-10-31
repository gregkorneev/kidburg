// npm start. В S0 только запуск сервера и печать адресов;
// проверки Ollama, QR-коды и автономный режим добавляются в S4.

import os from 'node:os';
import { startServer, DEFAULT_CONFIG } from '../server/index.js';

const port = Number(process.env.PORT ?? DEFAULT_CONFIG.port);
const app = await startServer({ port });

console.log(`Сервер запущен: http://localhost:${port}`);
for (const list of Object.values(os.networkInterfaces())) {
  for (const iface of list ?? []) {
    if (iface.family === 'IPv4' && !iface.internal) console.log(`  в сети: http://${iface.address}:${port}`);
  }
}

const stop = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

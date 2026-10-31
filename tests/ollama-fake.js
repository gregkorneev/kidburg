// Подменный сервер Ollama на loopback для тестов: модель и настоящая Ollama не нужны.

import { createServer } from 'node:http';

/** Запрос, пришедший на подменный сервер; `aborted` ставится, когда клиент оборвал соединение. */
function track(req, res, body) {
  const record = { method: req.method, url: req.url, body, aborted: false, finished: null };
  record.finished = new Promise((resolve) => {
    res.on('close', () => {
      record.aborted = !res.writableEnded;
      resolve(record);
    });
  });
  return record;
}

export async function fakeOllama(handler) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      body = null;
    }
    const record = track(req, res, body);
    requests.push(record);
    await handler(req, res, record);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    requests,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

const line = (content, done = false) =>
  JSON.stringify({ model: 'fake', message: { role: 'assistant', content }, done, ...(done ? { done_reason: 'stop' } : {}) }) + '\n';

/** Обычный ответ: фрагменты текста, затем done. */
export const tokensHandler = (tokens) => (req, res) => {
  res.writeHead(200, { 'content-type': 'application/x-ndjson' });
  for (const t of tokens) res.write(line(t));
  res.end(line('', true));
};

/** Начинает ответ и больше ничего не шлёт: ждёт, пока клиент оборвёт соединение. */
/** Первая фраза достаточно длинная и законченная: защита от повторов выдаёт её игроку сразу. */
export const FIRST_SENTENCE = 'Начало ответа, которое уже можно показать. ';
export const hangingHandler = (firstToken = FIRST_SENTENCE) => (req, res) => {
  res.writeHead(200, { 'content-type': 'application/x-ndjson' });
  res.write(line(firstToken));
};

/** Порт, на котором точно никто не слушает. */
export async function closedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export const ndjsonLine = line;

// Заглушка модуля агентов (роль 3 заменит). Контракт: shared/agent-api.md.

export function registerAgents(app, ctx) {}

// Эхо по словам: возвращает реплику игрока по одному слову за раз.
export async function* reply(req) {
  const words = String(req.text ?? '').split(/\s+/).filter(Boolean);
  for (const [i, word] of words.entries()) {
    if (req.signal?.aborted) return;
    yield i === 0 ? word : ` ${word}`;
  }
}

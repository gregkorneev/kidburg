// POST /api/telemetry — отчёт клиента о FPS и ping. Доступен любому вошедшему игроку (Bearer, как остальные /api),
// но возвращает только подтверждение: чужие данные игроку не отдаются, читать телеметрию может лишь админ-панель.

import { authenticate } from '../net/auth.js';
import { parseReport } from './index.js';

export function registerTelemetryRoutes(app, { db, telemetry, authSecrets, now = Date.now }) {
  app.post('/api/telemetry', { bodyLimit: 2048 }, async (req, reply) => {
    const user = authenticate(db, req, now(), authSecrets.session);
    if (!user) return reply.code(401).send({ error: 'unauth', message: 'Нужна авторизация' });
    const parsed = parseReport(req.body);
    if (!parsed.ok) return reply.code(400).send({ error: 'bad_report', message: parsed.error });
    const res = telemetry.report(user, parsed.report);
    if (!res.ok) return reply.code(res.status).send({ error: res.code, message: res.message });
    reply.header('cache-control', 'no-store');
    return { ok: true, intervalMs: res.intervalMs };
  });
}

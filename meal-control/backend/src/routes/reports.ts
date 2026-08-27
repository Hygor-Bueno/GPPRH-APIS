import { Router, Request, Response } from 'express';
import db from '../db';

const router = Router();

router.get('/daily', async (req: Request, res: Response) => {
  const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);

  const result = await db.execute({
    sql: `SELECT
            ml.id,
            ml.registration,
            e.name,
            ml.store_code,
            ml.served_at,
            ml.operator
          FROM meal_logs ml
          LEFT JOIN employees e ON e.registration = ml.registration
          WHERE date(ml.served_at) = ?
          ORDER BY ml.served_at DESC`,
    args: [date],
  });

  const logs = result.rows.map(r => ({
    id: Number(r.id),
    registration: String(r.registration),
    name: String(r.name ?? ''),
    store_code: String(r.store_code),
    served_at: String(r.served_at),
    operator: String(r.operator ?? ''),
  }));

  const byStore = logs.reduce<Record<string, number>>((acc, row) => {
    acc[row.store_code] = (acc[row.store_code] || 0) + 1;
    return acc;
  }, {});

  return res.json({ ok: true, date, total: logs.length, by_store: byStore, logs });
});

router.get('/employees', async (_req: Request, res: Response) => {
  const result = await db.execute(
    'SELECT id, registration, name, store_code FROM employees ORDER BY store_code, name'
  );
  const employees = result.rows.map(r => ({
    id: Number(r.id),
    registration: String(r.registration),
    name: String(r.name),
    store_code: String(r.store_code),
  }));
  return res.json({ ok: true, employees });
});

export default router;

import { Router, Request, Response } from 'express';
import db from '../db';
import { verifyQR } from '../jwt';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  const { token, operator } = req.body as { token?: string; operator?: string };

  if (!token) {
    return res.status(400).json({ ok: false, message: 'Token ausente' });
  }

  let payload;
  try {
    payload = verifyQR(token);
  } catch {
    return res.status(401).json({ ok: false, message: 'QR Code inválido ou corrompido' });
  }

  const { registration, store_code } = payload;

  const empResult = await db.execute({
    sql: 'SELECT * FROM employees WHERE registration = ?',
    args: [registration],
  });

  if (empResult.rows.length === 0) {
    return res.status(404).json({ ok: false, message: `Matrícula ${registration} não encontrada` });
  }

  const employee = empResult.rows[0];

  const today = new Date().toISOString().slice(0, 10);
  const alreadyResult = await db.execute({
    sql: `SELECT id FROM meal_logs
          WHERE registration = ?
            AND date(served_at) = date('now','localtime')`,
    args: [registration],
  });

  if (alreadyResult.rows.length > 0) {
    return res.status(409).json({
      ok: false,
      message: `${String(employee.name)} já foi servido(a) hoje`,
    });
  }

  await db.execute({
    sql: 'INSERT INTO meal_logs (registration, store_code, operator) VALUES (?, ?, ?)',
    args: [registration, store_code, operator || 'operador'],
  });

  return res.json({
    ok: true,
    message: 'Refeição registrada com sucesso!',
    employee: { name: String(employee.name), registration, store_code },
  });
});

export default router;

import { Router, Request, Response } from 'express';
import QRCode from 'qrcode';
import db from '../db';
import { signQR } from '../jwt';

const router = Router();

router.get('/:registration', async (req: Request, res: Response) => {
  const { registration } = req.params;

  const result = await db.execute({
    sql: 'SELECT * FROM employees WHERE registration = ?',
    args: [registration],
  });

  if (result.rows.length === 0) {
    return res.status(404).json({ ok: false, message: 'Colaborador não encontrado' });
  }

  const employee = result.rows[0];
  const store_code = String(employee.store_code);

  const token = signQR({ registration, store_code });
  const dataUrl = await QRCode.toDataURL(token, { width: 300, margin: 2 });

  return res.json({
    ok: true,
    registration,
    name: String(employee.name),
    store_code,
    qr_data_url: dataUrl,
    token,
  });
});

export default router;

import express from 'express';
import cors from 'cors';
import { initDb } from './db';
import mealRouter from './routes/meal';
import qrcodeRouter from './routes/qrcode';
import reportsRouter from './routes/reports';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/api/meal', mealRouter);
app.use('/api/qrcode', qrcodeRouter);
app.use('/api/reports', reportsRouter);

app.get('/health', (_req, res) => res.json({ ok: true }));

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Backend rodando em http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Erro ao inicializar banco:', err);
  process.exit(1);
});

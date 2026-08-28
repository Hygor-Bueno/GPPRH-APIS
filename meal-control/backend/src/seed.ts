import db, { initDb } from './db';

const employees = [
  { registration: 'EMP001', name: 'Ana Paula Ferreira', store_code: 'LOJA-01' },
  { registration: 'EMP002', name: 'Carlos Eduardo Lima', store_code: 'LOJA-01' },
  { registration: 'EMP003', name: 'Mariana Costa Santos', store_code: 'LOJA-01' },
  { registration: 'EMP004', name: 'João Pedro Alves', store_code: 'LOJA-02' },
  { registration: 'EMP005', name: 'Fernanda Oliveira', store_code: 'LOJA-02' },
  { registration: 'EMP006', name: 'Rafael Mendes', store_code: 'LOJA-02' },
  { registration: 'EMP007', name: 'Beatriz Souza', store_code: 'LOJA-02' },
  { registration: 'EMP008', name: 'Lucas Rodrigues', store_code: 'LOJA-03' },
  { registration: 'EMP009', name: 'Juliana Castro', store_code: 'LOJA-03' },
  { registration: 'EMP010', name: 'Thiago Barbosa', store_code: 'LOJA-03' },
];

async function seed() {
  await initDb();
  for (const emp of employees) {
    await db.execute({
      sql: 'INSERT OR IGNORE INTO employees (registration, name, store_code) VALUES (?, ?, ?)',
      args: [emp.registration, emp.name, emp.store_code],
    });
  }
  console.log('✅ Seed concluído: 10 colaboradores em 3 lojas inseridos.');
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });

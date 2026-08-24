const BASE = '/api';

export async function scanMeal(token: string, operator: string) {
  const res = await fetch(`${BASE}/meal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, operator }),
  });
  return res.json() as Promise<{
    ok: boolean;
    message: string;
    employee?: { name: string; registration: string; store_code: string };
  }>;
}

export async function getQRCode(registration: string) {
  const res = await fetch(`${BASE}/qrcode/${registration}`);
  return res.json() as Promise<{
    ok: boolean;
    name: string;
    registration: string;
    store_code: string;
    qr_data_url: string;
  }>;
}

export async function getDailyReport(date: string) {
  const res = await fetch(`${BASE}/reports/daily?date=${date}`);
  return res.json() as Promise<{
    ok: boolean;
    date: string;
    total: number;
    by_store: Record<string, number>;
    logs: {
      id: number;
      registration: string;
      name: string;
      store_code: string;
      served_at: string;
      operator: string;
    }[];
  }>;
}

export async function getEmployees() {
  const res = await fetch(`${BASE}/reports/employees`);
  return res.json() as Promise<{
    ok: boolean;
    employees: { id: number; registration: string; name: string; store_code: string }[];
  }>;
}

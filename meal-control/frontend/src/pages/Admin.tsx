import React, { useEffect, useState, useCallback } from 'react';
import Nav from '../components/Nav';
import { getEmployees, getDailyReport, getQRCode } from '../api';

type Employee = { id: number; registration: string; name: string; store_code: string };
type Log = {
  id: number; registration: string; name: string;
  store_code: string; served_at: string; operator: string;
};
type QRModal = { name: string; registration: string; store_code: string; qr_data_url: string } | null;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export default function Admin() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [byStore, setByStore] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [date, setDate] = useState(todayStr());
  const [qrModal, setQrModal] = useState<QRModal>(null);
  const [loadingQR, setLoadingQR] = useState('');

  const loadEmployees = useCallback(async () => {
    const data = await getEmployees();
    if (data.ok) setEmployees(data.employees);
  }, []);

  const loadReport = useCallback(async (d: string) => {
    const data = await getDailyReport(d);
    if (data.ok) {
      setLogs(data.logs);
      setByStore(data.by_store);
      setTotal(data.total);
    }
  }, []);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);
  useEffect(() => { loadReport(date); }, [date, loadReport]);

  const openQR = async (registration: string) => {
    setLoadingQR(registration);
    const data = await getQRCode(registration);
    setLoadingQR('');
    if (data.ok) setQrModal(data);
  };

  const printQR = () => {
    if (!qrModal) return;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`
      <html><body style="text-align:center;font-family:sans-serif;padding:40px">
        <h2>${qrModal.name}</h2>
        <p>Matrícula: <strong>${qrModal.registration}</strong> | Loja: <strong>${qrModal.store_code}</strong></p>
        <img src="${qrModal.qr_data_url}" width="260" height="260" style="margin:16px 0;display:block;margin-left:auto;margin-right:auto"/>
        <script>window.onload=()=>{window.print();window.close()}<\/script>
      </body></html>
    `);
    win.document.close();
  };

  const servedSet = new Set(logs.map(l => l.registration));

  return (
    <>
      <Nav />
      <main className="admin-page">

        {/* ── Relatório diário ── */}
        <div className="card">
          <div className="card-header">
            <h2>📊 Relatório Diário</h2>
            <div className="date-filter">
              <input
                type="date"
                value={date}
                max={todayStr()}
                onChange={e => setDate(e.target.value)}
              />
              <button className="btn btn-outline" style={{ flex: 'unset', padding: '7px 14px' }}
                onClick={() => loadReport(date)}>
                ↻
              </button>
            </div>
          </div>
          <div className="card-body">
            <div className="stats-row" style={{ marginBottom: 20 }}>
              <div className="stat-box">
                <div className="stat-value">{total}</div>
                <div className="stat-label">Total do dia</div>
              </div>
              {Object.entries(byStore).map(([store, count]) => (
                <div className="stat-box" key={store}>
                  <div className="stat-value">{count}</div>
                  <div className="stat-label">{store}</div>
                </div>
              ))}
            </div>

            {logs.length === 0 ? (
              <p className="state-msg">Nenhuma refeição registrada nesta data.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Horário</th>
                      <th>Nome</th>
                      <th>Matrícula</th>
                      <th>Loja</th>
                      <th>Operador</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(log => (
                      <tr key={log.id}>
                        <td>{fmtTime(log.served_at)}</td>
                        <td>{log.name || '—'}</td>
                        <td>{log.registration}</td>
                        <td><span className="badge badge-store">{log.store_code}</span></td>
                        <td>{log.operator}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ── Colaboradores ── */}
        <div className="card">
          <div className="card-header">
            <h2>👥 Colaboradores</h2>
            <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
              {employees.length} cadastrados
            </span>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Matrícula</th>
                    <th>Loja</th>
                    <th>Hoje</th>
                    <th>QR Code</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map(emp => (
                    <tr key={emp.id}>
                      <td>{emp.name}</td>
                      <td>{emp.registration}</td>
                      <td><span className="badge badge-store">{emp.store_code}</span></td>
                      <td style={{ color: servedSet.has(emp.registration) ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                        {servedSet.has(emp.registration) ? '✓ Servido' : '—'}
                      </td>
                      <td>
                        <button
                          className="btn btn-primary"
                          style={{ flex: 'unset', padding: '6px 14px', fontSize: '0.8rem' }}
                          onClick={() => openQR(emp.registration)}
                          disabled={loadingQR === emp.registration}
                        >
                          {loadingQR === emp.registration ? '...' : '🔳 Gerar QR'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      {/* ── QR Modal ── */}
      {qrModal && (
        <div className="qr-modal-bg" onClick={() => setQrModal(null)}>
          <div className="qr-modal" onClick={e => e.stopPropagation()}>
            <h3>{qrModal.name}</h3>
            <p className="qr-sub">{qrModal.registration} · {qrModal.store_code}</p>
            <img src={qrModal.qr_data_url} alt="QR Code" />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={printQR}>🖨 Imprimir</button>
              <button className="btn btn-outline" onClick={() => setQrModal(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

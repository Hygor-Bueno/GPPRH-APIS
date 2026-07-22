# 🥗 PegPese — Controle de Refeições (MVP)

Sistema para contabilizar refeições servidas aos colaboradores, com leitura de QR Code via câmera do celular.

---

## Estrutura

```
meal-control/
  backend/   → Node.js + Express + SQLite + JWT
  frontend/  → React + Vite + qr-scanner
```

---

## Instalação

### Backend

```bash
cd backend
npm install
npm run seed        # insere 10 colaboradores fictícios
npm run dev         # porta 3001
```

### Frontend

```bash
cd frontend
npm install
npm run dev         # porta 5173, exposto na rede local
```

---

## Acessar do celular

1. Rode `ipconfig` (Windows) e anote o IPv4 da interface de rede local.
2. No celular (mesma rede Wi-Fi), acesse: `http://[SEU_IP]:5173`
3. A câmera funciona em HTTP local — não precisa de HTTPS na rede interna.

---

## Endpoints do Backend

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/meal` | Registra refeição (body: `{ token, operator }`) |
| `GET`  | `/api/qrcode/:registration` | Gera QR Code para a matrícula |
| `GET`  | `/api/reports/daily?date=YYYY-MM-DD` | Relatório do dia |
| `GET`  | `/api/reports/employees` | Lista todos os colaboradores |

---

## Variáveis de ambiente (backend)

Crie um `.env` na pasta `backend/` se quiser sobrescrever:

```
PORT=3001
JWT_SECRET=sua-chave-secreta-aqui
```

---

## Regras de negócio

- Cada colaborador pode receber **apenas 1 refeição por dia**
- Se já foi servido, o sistema retorna erro com nome do colaborador
- O operador é salvo no log (nome digitado na tela de Scanner, persistido no localStorage)

---

## Colaboradores de seed

| Matrícula | Nome | Loja |
|-----------|------|------|
| EMP001 | Ana Paula Ferreira | LOJA-01 |
| EMP002 | Carlos Eduardo Lima | LOJA-01 |
| EMP003 | Mariana Costa Santos | LOJA-01 |
| EMP004 | João Pedro Alves | LOJA-02 |
| EMP005 | Fernanda Oliveira | LOJA-02 |
| EMP006 | Rafael Mendes | LOJA-02 |
| EMP007 | Beatriz Souza | LOJA-02 |
| EMP008 | Lucas Rodrigues | LOJA-03 |
| EMP009 | Juliana Castro | LOJA-03 |
| EMP010 | Thiago Barbosa | LOJA-03 |

---

## Banco de dados

SQLite em `backend/data/meal-control.db` — criado automaticamente na primeira execução. Não requer instalação externa.

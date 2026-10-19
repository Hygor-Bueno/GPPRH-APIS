# Prompt — REPP: lembrete da reserva

> Copie tudo abaixo da linha para quem vai consumir as rotas (agente do
> frontend, Postman, etc.). Continuação de `docs/repp-frontend-prompt.md`
> (notificações e `repp:event`).
>
> Estado do backend em 19/10/2026: código testado (jest + SQL validado contra
> tabelas temporárias no `global`). Só funciona em produção depois de rodar
> `GIPP-SQL/re-lembrete-deploy.sql` e depois do rebuild do container
> `api-gipp-enterprises`, que sobe o worker `repp-reminder`.

---

# REPP — lembrete da reserva

Base: `/api/v1/global/spaces`. Erro: `{ error: true, message, code }`, então
decida pelo `code`, nunca pelo texto.

O **front não agenda nada**. Ele só envia a escolha. Quem dispara é o backend:
na hora certa, o aviso chega como qualquer outro aviso da REPP, gravado (vem no
`GET /spaces/notifications`) e em tempo real (`repp:event`), com
`action: "reminder"`. Funciona com a aba fechada, em outro computador ou
depois de um reload.

## 1. Formulário de reserva (criar e editar)

Um select **"Lembrete"** com estas opções:

| Rótulo | `reminder_minutes` |
|---|---|
| Sem lembrete | `null` |
| 15 minutos antes | `15` |
| 30 minutos antes | `30` |
| 1 hora antes | `60` |
| 2 horas antes | `120` |
| 1 dia antes | `1440` |

```
POST /api/v1/global/spaces/bookings
{ ...campos de sempre, "reminder_minutes": 30 }

PUT /api/v1/global/spaces/bookings/:id
{ "reminder_minutes": 60 }        // ou null para tirar
```

- No `POST`, ausente = sem lembrete. No `PUT`, ausente = fica como está.
- Outro valor → 400 `REPP_INVALID_REMINDER`.
- A reserva completa (`GET /bookings/:id`, `/bookings/mine`, resposta do
  POST/PUT) traz `reminder_minutes` (`null` = sem) e `reminder_sent_at`
  (`null` = ainda não enviado).

### Quem pode mexer

Só **quem criou** a reserva recebe o lembrete, e só ele altera a antecedência.

- Mostre o select habilitado quando `created_by === usuário logado`. Para o
  administrador que edita a reserva de outra pessoa, mostre-o desabilitado
  (ou esconda).
- Se o formulário do admin reenviar o **mesmo** valor que carregou, passa. Valor
  diferente → 403 `REPP_REMINDER_FORBIDDEN`.

### Regras que vale explicar na tela

- **Só reserva aprovada recebe o lembrete.** Pendente guarda a escolha. Se for
  aprovada depois do horário do lembrete, o aviso sai na hora da aprovação.
  Sugestão de texto de ajuda: "Você será lembrado se a reserva estiver
  aprovada."
- Lembrete cujo horário já passou (ex.: reserva para daqui a 20 min com "1 hora
  antes") sai **na hora**, não é recusado.
- Remarcar ou trocar a antecedência rearma o lembrete.

## 2. Sino / toast

Trate `action: "reminder"` como os outros avisos (mesmo formato, mesmo `id`
para não duplicar, mesma confirmação por `PATCH /spaces/notifications/read`):

```json
{
  "id": 812, "action": "reminder", "booking_id": 37,
  "space_name": "Auditório", "booking_date": "2026-10-20",
  "start_time": "14:00", "end_time": "15:00",
  "title": "Integração", "requester_name": "Fulano",
  "by_name": null, "reason": null, "previous": null,
  "by_user_id": null
}
```

- `by_name`/`by_user_id` vêm `null`: ninguém agiu. Não escreva "X lembrou você".
- Texto sugerido, com o horário calculado a partir de `booking_date` +
  `start_time` (o aviso pode sair atrasado, então não escreva "em 30 minutos"):
  **"Lembrete: Integração no Auditório hoje às 14:00."** (ou "amanhã às", ou a
  data quando for outro dia).
- Opcional: se a aba estiver aberta e o usuário tiver permitido, dispare também
  uma `Notification` do navegador ao receber o `repp:event`. Isso é só
  apresentação; o agendamento continua no backend.

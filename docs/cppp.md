# CPPP — Controle de Ponto Peg Pese

Integração com os relógios de ponto **Control iD REP-C**, AFD da Portaria
671/2021. Cada relógio tem o seu IP e é cadastrado pela tela; login e senha de
admin são os mesmos para todos, no `.env`. Substitui o ETL Python de linha de comando
(`Downloads\controlid-etl`): coleta, detecção de inconsistências e ajuste ficam
dentro da ferramenta, tratados na própria tela.

Construído em 08/10/2026. Tabelas `cppp_*` no MySQL `global`, código em
`src/modules/global` na convenção da casa (domain / application / infrastructure).

---

## Restrição inegociável

**Não existe alterar nem inserir marcação no relógio.** Num REP-C a memória de
registro é gravável uma única vez, o NSR é estritamente sequencial e cada linha
tem CRC próprio. É o que dá valor probatório ao AFD.

Portanto:

- nenhuma rota escreve no relógio: o cliente só conhece `login`, `get_afd` e `logout`;
- `cppp_afd_records` recebe só o INSERT da carga. O **banco** recusa UPDATE e
  DELETE por trigger, e um teste (`cppp-infrastructure.test.js`) falha se aparecer
  código escrevendo nela;
- toda correção vira linha em `cppp_punch_adjustments`, com a marcação original
  intacta ao lado. Ajuste não se apaga, cancela-se, com autor e motivo.

Se uma demanda parecer exigir escrever no relógio ou no espelho, o desenho está
errado.

---

## Decisões (08/10/2026)

| Pergunta | Decisão |
|---|---|
| Jornada / status do contrato | Protheus, em tempo real (`view_employee_with_company_info`). Horário contratado fica para depois, então **dia sem marcação não é apontado** nesta entrega. |
| Permissões | `CPPP_USE` (ver), `CPPP_ADJUST` (lançar/cancelar ajuste, abrir anexo), `CPPP_COLLECT` (cadastrar relógio, disparar coleta, baixar AFD). Papéis: `CPPP_RH` = USE+ADJUST; `CPPP_MANAGER` = os três. |
| Aprovação | Ajuste vale direto, com autoria. |
| Vários relógios | Modelado desde já: chave `(device_id, nsr)`. |
| Agenda | Uma coleta por dia (`CPPP_COLLECT_TIME`, padrão 02:00), referente ao dia anterior. |
| Processo | App PM2 `cppp-afd-collector` (`instances: 1`) no container interno, não serviço Docker novo. |

### Onde o código diverge do documento de origem

1. **Tabelas com prefixo da suite:** `afd_records`, `etl_runs` e `punch_adjustments` viraram `cppp_afd_records`, `cppp_collect_runs` e `cppp_punch_adjustments`, mais `cppp_devices`.
2. **AFD integral não tem só 1 linha não reconhecida.** Tem quatro: o cabeçalho tipo 1 (no FIM, NSR 0), o trailer tipo 9 com a contagem por tipo, a linha de assinatura e o rodapé `AFD….txt`. As quatro são reconhecidas; `rejected_count` volta a significar "linha que pode ser registro perdido".
3. **O campo "CPF" guarda CPF ou PIS.** No AFD de 08/10 há 1.411 identificadores: 959 são só CPF, 307 só PIS (32 deles batem ponto) e 25 não passam em nenhum dígito. Só o **inválido** fica fora da análise. Excluir "CPF inválido" tiraria 32 pessoas reais da tela.
4. **Bruto byte a byte de verdade.** O Python gravava o texto decodificado; aqui vai o `Buffer` da resposta, com SHA-256 conferido no download.
5. **Coleta disparada pela tela é enfileirada** (status `queued`, a mais que o documento). Quem coleta é só o worker; a API fala com o relógio apenas no teste de conexão do cadastro (login + logout).
8. **Relógios cadastrados pela tela, não por SQL** (pedido de 08/10/2026: cada relógio tem um IP). Uma credencial para todos, no `.env`.
6. **Mediana do `fecha_cedo` em janela própria** (`CPPP_BASELINE_DAYS`, 60 dias), e não no período filtrado. Com o filtro, uma semana teria menos de 5 dias de base e a regra pararia de acusar.
7. **Tipo de ajuste novo, `desconsiderar_leitura`:** nenhum tipo da lista original resolvia uma `duplicada`. Ele aponta o NSR e não apaga nada.

---

## Os seis movimentos da tela

Base: `https://gigpp.com.br:73/api/v1/global/cppp`

| # | Movimento | Rota | Permissão |
|---|---|---|---|
| 1 | Listar inconsistências | `GET /inconsistencies?from&to&cpf&issue&status&page&limit` | USE |
| 2 | Detalhe do dia | `GET /days/:cpf/:date` | USE |
| 3 | Lançar ajuste | `POST /adjustments` (JSON ou multipart, anexo em `file`) | ADJUST |
| 4 | Ocorrência sai da lista | a resposta do 3 (e do cancelamento) traz `day` recalculado | — |
| 5 | Disparar coleta e acompanhar | `POST /collect-runs {device_id}` → `GET /collect-runs/:id` | COLLECT / USE |
| 6 | Histórico e última coleta | `GET /collect-runs`, `GET /devices` | USE |

Outras rotas:

- `GET /punches?view=afd|tratada`: as duas visões, **obtidas separadamente**. A `afd` é a fiscal (só o relógio, em ordem de NSR, com `raw_line`). A `tratada` é AFD + ajustes, agrupada por dia, e é o que folha e relatórios consomem.
- `GET /employees?search&all=1`: pessoas conhecidas do relógio, para o filtro. Por padrão só quem tem marcação, porque o cadastro do relógio tem cerca de 1.400 identificadores.
- `GET /adjustments`, `PATCH /adjustments/:id/cancel {reason}`, `GET /adjustments/:id/attachment` (ADJUST).
- `GET /collect-runs/:id/afd`: AFD bruto, com header `X-Content-SHA256` (COLLECT).

### Como uma ocorrência "sai da lista"

Nada guarda estado de "resolvido". A cada consulta, as regras rodam sobre a
**visão AFD** e sobre a **visão tratada**:

- **pendente:** a regra ainda acusa na visão tratada, num dia não justificado;
- **tratada:** acusava na visão AFD e deixou de acusar.

Batida esquecida entra na visão tratada e leitura desconsiderada sai dela.
Atestado, declaração, abono, férias, folga e falta justificada **justificam o
dia inteiro**. Um ajuste errado, como uma batida esquecida que deixa o dia ainda
ímpar, mantém a ocorrência pendente.

### O dia corrente nunca aparece

O corte (`window.cutoff`) é o **menor** entre dois dias:

- ontem;
- a véspera da última coleta `success` (pelo `started_at`).

Coleta falhando por três dias deixa o corte três dias para trás, em vez de
mostrar dia pela metade. Sem nenhuma coleta concluída, a resposta traz
`window.no_collection: true`.

---

## Regras de detecção

São um porte de `controlid_etl/audit.py`, em `domain/cppp/inconsistency/punch-inconsistency.rules.js`.
Conferência: agosto/2026 reproduz exatamente os números do ETL, **515 ocorrências; 427 em 103 pessoas com o corte em 27/08**.

| Regra | Condição | Parâmetro |
|---|---|---|
| `batida_unica` | um registro no dia | — |
| `batida_impar` | número ímpar de batidas | — |
| `duplicada` | duas leituras a ≤ N min | `CPPP_DUPLICATE_WINDOW_MINUTES` (3) |
| `fecha_cedo` | dia par, última batida N+ min antes da mediana da pessoa | `CPPP_EARLY_CLOSE_MINUTES` (90), `CPPP_MIN_BASELINE_DAYS` (5) |

O dia típico tem **6 batidas**. Nada assume 4.

Estas não são inconsistências e não aparecem como tal:

- **Tipo 6** são eventos do equipamento, não justificativa de ausência.
- **Dia sem marcação** não é apontado até existir jornada contratada. O AFD não distingue falta de desligado ou de lotado em outro relógio.

---

## Coleta

```
worker (a cada 15s, com GET_LOCK)
  ├─ coleta `running` há > 30 min → failed ("interrompida")
  ├─ passou de 02:00 e não há agendada de hoje → enfileira
  └─ executa a fila:
       1. pede a partir do FIM DO PRIMEIRO BLOCO CONTÍNUO de NSR (integral na 1ª vez)
       2. grava o AFD bruto (wx, 0444, SHA-256) ANTES do parse
       3. confere o REP do rodapé contra cppp_devices.rep_number → diferente = nada gravado
       4. grava só NSR novo; idêntico conta como idempotente; divergente é acusado e nunca sobrescrito
       5. confere continuidade (buraco = failed) e trailer (divergência = aviso)
```

- **Por que recomeçar do primeiro buraco, e não do maior NSR:** o NSR é contínuo entre todos os tipos (no AFD integral de 08/10, de 1 a 44.661 sem buraco). Se algum registro não entrar, a próxima coleta o pede de novo, e a idempotência absorve o que vier repetido. "Sem perder registro" é verificado, não presumido.
- **Por que o trailer só gera aviso:** no AFD integral ele bate. Ainda não se sabe se, numa resposta incremental, ele conta só a resposta ou a memória inteira. Endurecer depois de observar coletas reais.
- **Uma coleta viva por relógio,** garantida pelo banco (`uq_cppp_runs_active`). Um segundo clique recebe 409.
- **Filtro de data do relógio não é usado.** Ele é aproximado: pedindo 01/08, o relógio devolveu desde 31/07. É sempre NSR.

---

## Dados

DDL: `GIPP-SQL/cppp-deploy.sql` (fora do repo).

- `cppp_afd_records`: PK `(device_id, nsr)`. `occurred_at` é hora de parede do relógio, sem conversão, com `utc_offset` como veio. Ordene relatório por NSR.
- `cppp_collect_runs`: a fila e o histórico, com contagens (`extracted`, `inserted`, `identical`, `rejected`, `conflict`), o caminho e o hash do bruto, `error` e `warnings`.
- `cppp_punch_adjustments`: `type`, a forma de cada tipo (`punch_at`, `device_id+nsr`, intervalo ou período), `reason`, `attachment_file_id`, `created_by`, e o cancelamento. Um trigger impede alterar qualquer coisa além do cancelamento.
- `cppp_devices`: código, nome, IP e número do REP, cadastrados pela tela. **A senha não fica no banco.**

### Relógios: cadastro pela tela

- **Rotas:** `POST /devices` e `PUT /devices/:id`, com `CPPP_COLLECT`. Não existe DELETE, porque o espelho referencia o relógio para sempre; o caminho é desativar.
- **Teste de conexão:** `POST /devices/test-connection {base_url}` testa um IP antes de salvar, e `POST /devices/:id/test-connection` testa um relógio cadastrado. Os dois fazem só login + logout. Falha volta como 200 com `ok: false` e o motivo.
- **Código:** não muda depois de criado, porque vai no caminho dos arquivos de AFD.
- **IP:** pode mudar quando o relógio troca de rede. Precisa ser **IP literal** dentro de `CPPP_DEVICE_ALLOWED_NETWORKS`, e é único entre relógios.
- **Por que restringir o IP:** o servidor manda a senha compartilhada no login. Sem a restrição, quem cadastra relógio apontaria um para um servidor próprio e receberia a senha de todos. Mesmo com ela, alguém na rede interna ainda consegue, então **`CPPP_COLLECT` deve ficar com poucas pessoas**.
- **REP:** pode ficar vazio no cadastro. A primeira coleta o aprende do rodapé do AFD.
  - Se o REP já pertencer a outro cadastro, ou seja, dois cadastros para o mesmo equipamento, a coleta falha sem gravar nada.
  - Depois que o relógio tem registros, o REP não troca: outro equipamento é outro cadastro.
- **Sessão:** cada coleta e cada teste fazem login → operação → logout, com conexão própria. Nenhuma sessão é reaproveitada, porque o login do relógio expira.

O AFD bruto fica em `CPPP_STORAGE_ROOT`, por padrão `storage/cppp`, que é bind mount do host:
`afd/<CODE>/<AAAA>/<MM>/afd_<CODE>_run<id>_<AAAAMMDD_HHMMSS>.txt`.

### Funcionário

O nome, a matrícula, a filial e o status do contrato vêm do Protheus por CPF, em
tempo real (`SqlServerCpppEmployeeDirectory`). Quando o Protheus não encontra,
cai no nome do cadastro do próprio relógio (tipo 5). Se o SQL Server estiver
fora, a tela funciona assim mesmo e avisa (`employee_lookup_failed`).

### Anexo (atestado)

Vai para o `_files` (módulo `CPPP`). Foto é convertida para WebP; PDF fica como veio.
**Atestado é dado de saúde (LGPD, art. 11).** A rota genérica
`GET /global/files/:fileId` serve qualquer arquivo a qualquer usuário logado, por
isso o módulo `CPPP` está em `RESTRICTED_MODULES` do `files.controller` e
responde 404 ali. O anexo só sai por `GET /cppp/adjustments/:id/attachment`, que
exige `CPPP_ADJUST`.

---

## Variáveis de ambiente

| Variável | Padrão | |
|---|---|---|
| `CPPP_DEVICE_PASSWORD` | — | **obrigatória** — a mesma para todos os relógios |
| `CPPP_DEVICE_LOGIN` | `admin` | |
| `CPPP_DEVICE_ALLOWED_NETWORKS` | faixas privadas | CIDRs onde um relógio pode ser cadastrado |
| `CPPP_TEST_TIMEOUT_SECONDS` | `15` | botão "testar conexão" |
| `CPPP_VERIFY_TLS` | `true` | **precisa ser `false` em produção** (certificado autoassinado) |
| `CPPP_COLLECT_TIME` | `02:00` | coleta diária |
| `CPPP_TIMEOUT_SECONDS` | `180` | AFD integral é lento |
| `CPPP_AFD_MODE` | `671` | |
| `CPPP_STORAGE_ROOT` | `<api>/storage/cppp` | |
| `CPPP_QUEUE_POLL_SECONDS` | `15` | fila da coleta manual |
| `CPPP_STUCK_RUN_MINUTES` | `30` | |
| `CPPP_DUPLICATE_WINDOW_MINUTES` | `3` | |
| `CPPP_EARLY_CLOSE_MINUTES` | `90` | |
| `CPPP_MIN_BASELINE_DAYS` | `5` | |
| `CPPP_BASELINE_DAYS` | `60` | histórico do `fecha_cedo` |
| `CPPP_MAX_PERIOD_DAYS` | `92` | período de consulta e de ajuste |

---

## Deploy

1. Rodar `GIPP-SQL/cppp-deploy.sql` no MySQL `global`. Ele cria as tabelas, os triggers, as permissões, os papéis e o primeiro relógio (INTERLAGOS), que fica editável pela tela.
2. No `.env` do servidor: `CPPP_DEVICE_PASSWORD` (a mesma para todos os relógios) e `CPPP_VERIFY_TLS=false`.
3. `docker compose build && docker compose up -d`, o mesmo comando de sempre (CLAUDE.md). O worker sobe junto, no mesmo container interno.
4. **Rede:** na tela de relógios, "testar conexão" (`POST /cppp/devices/:id/test-connection`). Ele roda de dentro do container, que é de onde a coleta sai. O ETL rodava da máquina do Hygor, e a rota a partir do servidor não foi verificada.
   - Sem a tela, o equivalente pelo terminal do servidor usa `node`, porque a imagem `node:22-bookworm-slim` **não tem `curl`**:
     `docker compose exec api-gipp-enterprises node -e "require('https').get('https://192.168.10.28/',{rejectUnauthorized:false},r=>console.log('HTTP',r.statusCode)).on('error',e=>console.log(e.code))"`
5. Cadastrar os demais relógios pela tela, cada um com o seu IP.
6. Conferir `logs/cppp-afd-collector-out.log`. A primeira coleta de cada relógio é a **integral** (cerca de 44 mil linhas no INTERLAGOS, desde 29/04/2026). Ela roda no primeiro ciclo depois de 02:00, ou na hora, por `POST /cppp/collect-runs`.
7. Conceder `CPPP_RH` / `CPPP_MANAGER` às pessoas. O card do menu (`_application_access`) depende de a aplicação existir; ver o rodapé do `.sql`.

Testes: `node node_modules/jest/bin/jest.js --testPathPattern="cppp"`. Pelo caminho de rede o `npm` quebra.

---

## Pontas soltas

- **Quem bate ponto por PIS não é encontrado no Protheus.** A view não expõe `RA_PIS`. Essas 32 pessoas aparecem com o nome do cadastro do relógio e sem status de contrato. Caminho: acrescentar `EmployeePIS` à view e buscar pelos dois. Além disso, PIS no campo de CPF do AFD 671 é assunto de cadastro do relógio: vale o RH recadastrar essas pessoas por CPF.
- **Formato do `EmployeeCPF` na view não foi conferido** (a consulta de leitura foi bloqueada nesta sessão). A busca normaliza pontuação, espaços e zeros dos dois lados, mas convém rodar no SSMS:
  `SELECT TOP 5 EmployeeCPF, LEN(EmployeeCPF) FROM view_employee_with_company_info`.
- **Jornada contratada:** sem ela, dia sem marcação não é apontado. É a próxima decisão de produto.
- **Trailer no incremental:** observar as primeiras coletas diárias. Se ele bater, tornar divergência uma falha.
- **Retenção do AFD bruto:** cada coleta diária grava um arquivo pequeno, e a integral cerca de 3 MB. Não há purga, e não deveria haver sem decisão do jurídico (prazo de guarda fiscal).
- **Tela (front):** não faz parte desta entrega. Os contratos acima são o que ela consome.
- O AFD de 28/08 gravado pelo Python (`afd_20260828_145822.txt`) tem CR duplicado. Não importa: a primeira coleta integral traz tudo de novo, direto do relógio.

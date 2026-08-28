# Tratamento de dado biométrico no controle de refeitório

**Documento para assinatura.** Rascunho redigido pelo desenvolvimento em 18/08/2026,
conforme a etapa 0 do plano de refeitório. Não é parecer jurídico: é a
transcrição das decisões técnicas já tomadas, no formato que alguém com
autoridade para aceitar o risco possa ler e assinar.

| | |
|---|---|
| **Controlador** | `[RAZÃO SOCIAL]` — CNPJ `[CNPJ]` |
| **Operação** | Reconhecimento facial como forma **opcional** de identificação no refeitório |
| **Encarregado (DPO)** | `[NÃO NOMEADO — ver seção 8]` |
| **Assinatura** | `[NOME]`, `[CARGO]` — data `[__/__/____]` |

---

## 1. Finalidade

Identificar quem é servido no refeitório, para:

- contar refeições por pessoa e por dia;
- ratear o custo por centro de custo e por filial;
- faturar contra a empresa contratante, quando a refeição é de terceiro.

O reconhecimento facial **não** tem finalidade de controle de jornada, de
vigilância ou de segurança patrimonial. Não há registro de imagem, não há
conferência visual de identidade por foto, e a tela do operador não exibe
fotografia de ninguém — decisão registrada no plano: *o objetivo é medição e
rateio, não policiamento*.

## 2. Base legal

**Art. 11, I da Lei 13.709/2018 — consentimento específico e destacado.**

Dado biométrico é dado pessoal sensível. A lista de bases legais do art. 11 é
**fechada** e não inclui legítimo interesse, o que elimina a alternativa mais
cômoda. Sobra o consentimento.

O problema conhecido do consentimento de empregado é a presunção de que ele não
é livre, pela subordinação. O remédio adotado aqui não é argumentativo, é
estrutural:

- **o QR Code é o caminho padrão**, e continua funcionando para todos;
- **o facial é adesão voluntária**, por link individual, fora do horário e do
  local de trabalho se a pessoa quiser;
- **quem recusa não sofre nenhum prejuízo** — nem fila separada, nem demora, nem
  registro da recusa.

A liberdade do consentimento, aqui, fica evidente em vez de argumentada: o
caminho alternativo não é uma exceção prevista no papel, é o fluxo normal do
sistema.

## 3. O que é guardado

| Guardado | Não guardado |
|---|---|
| Vetor numérico do rosto (512 números, `VARBINARY(2048)`) | **Fotografia ou qualquer imagem** |
| Identificação do modelo que gerou o vetor (`model_tag`) | Vídeo |
| Data, versão e IP do consentimento | Dado de outra pessoa que não consentiu |
| Como a identidade foi provada no cadastro | |

A promessa "só o vetor" é **restrição de schema, não disciplina de
programador**: a tabela `GIPP.dbo.meal_biometric` não tem coluna de imagem. Não
existe lugar para guardar uma foto mesmo que alguém queira.

As imagens capturadas no autocadastro são convertidas em vetor em memória e
**descartadas sem tocar disco**.

### Sobre irreversibilidade

O vetor **não** é tratado como anonimizado. A irreversibilidade de *embeddings*
não é garantida pela literatura, e de todo modo a classificação como dado
sensível vem da **finalidade** — identificar unicamente uma pessoa — e não do
formato do arquivo. Por isso todo este documento se aplica ao vetor com o mesmo
rigor que se aplicaria a uma fotografia.

## 4. Onde fica, e por quanto tempo

**Onde:** SQL Server corporativo (`GIPP.dbo`), na rede da empresa. O
reconhecimento roda em container próprio, publicado apenas em *loopback*. **O
vetor nunca sai da rede da empresa** — não há envio para API de terceiro, e essa
foi uma das razões da escolha por solução self-hosted.

**Comparação 1:1, nunca 1:N.** A matrícula estreita a busca para uma única
linha; o rosto apenas confirma. Não existe função de "identificar esta pessoa
entre todas" no sistema.

**Por quanto tempo:** até 30 dias após o desligamento, ou até a revogação, o que
vier primeiro.

O expurgo é uma consulta agendada, versionada junto do código:

```sql
DELETE b
FROM GIPP.dbo.meal_biometric b
INNER JOIN TMPPRD12.dbo.SRA020 rh
        ON rh.RA_MAT    = b.employee_id
       AND rh.RA_FILIAL = b.branch_code
WHERE rh.RA_DEMISSA <> ''
  AND DATEDIFF(DAY, CONVERT(DATE, rh.RA_DEMISSA, 112), GETDATE()) > 30;
```

O vetor mora no mesmo banco do cadastro de pessoal justamente por causa desta
consulta: é um `JOIN` na mesma instância, agendado. Em bancos separados o
expurgo dependeria de um job de sincronismo funcionar — e *"o expurgo depende de
um sincronismo funcionar"* não é frase para dizer à ANPD.

**O histórico de refeições não é apagado.** Matrícula, data e loja não são dado
sensível, e o registro é documento de custo e de auditoria. Some o vetor, fica a
contabilidade.

## 5. O caminho de quem recusa

Quem não adere continua usando **QR Code**, exatamente como todos usavam antes
do facial existir. Não há:

- fila, horário ou guichê separado;
- necessidade de justificar a recusa;
- registro de que a pessoa recusou.

A coluna `identified_by` de cada refeição registra **qual caminho foi usado** —
QR, manual, facial ou botão de grupo. Ela existe como prova de que a alternativa
não é teórica: se o relatório mostra refeições sendo servidas por QR todos os
dias, a liberdade de escolha está demonstrada por dado, não por declaração.

## 6. Direitos do titular

A pessoa pode, a qualquer momento e sem justificar:

- **revogar o consentimento** — o vetor é marcado como revogado e removido no
  expurgo seguinte, e a identificação volta a ser por QR;
- **confirmar** se há tratamento e **acessar** o que existe a seu respeito;
- **pedir a eliminação** do vetor;
- **reclamar** ao encarregado ou à ANPD.

Canal para exercer: `[CANAL — e-mail, RH, ou o que for definido]`.

## 7. Registro de consentimento

Cada adesão grava, no momento em que acontece: data e hora, versão do texto
aceito, e IP de origem. Não há papel a arquivar nem assinatura a reconhecer — a
prova é o próprio registro, versionado.

A **versão** do texto é o que permite saber exatamente ao que cada pessoa
aderiu, quando o texto mudar.

## 8. Pendência: encarregado não nomeado

A empresa **não tem encarregado nomeado**. O art. 41 exige a indicação.

O encarregado pode ser pessoa jurídica externa, e terceirizar é caminho
legítimo. Mas **terceirizar não transfere a responsabilidade**: o controlador
continua respondendo. Contratar consultoria para o papel resolve a indicação e a
orientação técnica; não resolve a exposição da empresa.

Isto é decisão de gestão, não de desenvolvimento, e está fora do que este
documento pode resolver.

## 9. O que a assinatura significa

Assinando, `[NOME/CARGO]` declara, em nome do controlador:

1. que a finalidade da seção 1 é a finalidade real e única;
2. que aceita o risco de tratar dado pessoal sensível nas condições descritas;
3. que autoriza o desenvolvimento a implementar as etapas 6 e 7 do plano de
   refeitório — autocadastro por link, piloto de reconhecimento facial, rotina
   de expurgo e trilha de auditoria.

**Sem esta assinatura, as etapas 6 e 7 não começam.** As etapas 1 a 4 — QR Code,
contagem, rateio e relatório — já estão em produção e **não geram vetor
nenhum**, por isso não dependem deste documento.

---

### Anexo — onde cada promessa aparece no sistema

| Promessa | Onde é garantida |
|---|---|
| Só o vetor, nunca imagem | ausência de coluna de imagem em `meal_biometric` |
| Modelo identificado | coluna `model_tag`, obrigatória |
| Consentimento datado e versionado | `consent_at`, `consent_version`, `consent_ip` |
| Revogação | coluna `revoked_at` |
| Expurgo em 30 dias | consulta agendada e versionada (seção 4) |
| Alternativa ao facial existe e é usada | coluna `identified_by` em cada refeição |
| Comparação 1:1 | a busca exige matrícula antes do rosto |
| Vetor não sai da rede | container publicado só em loopback |
| Auditoria de cadastro suspeito | coluna `enroll_verified_by` |

### Anexo — piloto

Protótipo com rosto de colega **é tratamento biométrico real** e não ganha passe
livre por ser interno. O piloto da etapa 6 exige: grupo pequeno e identificado,
consentimento por escrito específico para o piloto, vetores apagados ao fim, e
**os dados do piloto não migram para produção**.

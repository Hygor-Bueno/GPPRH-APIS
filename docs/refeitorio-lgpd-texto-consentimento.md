# Texto de consentimento — cadastro facial do refeitório

**Rascunho para revisão jurídica pontual.** Redigido pelo desenvolvimento em
18/08/2026 (etapa 0 do plano de refeitório). O documento de base legal e
retenção é o `refeitorio-lgpd-tratamento-biometrico.md`; este arquivo é só o
**texto que a pessoa lê na tela** antes de aderir.

---

## Regras de escrita adotadas

1. **Segunda pessoa e voz ativa.** Quem lê tem que entender de primeira, num
   celular, na fila. "Você pode desistir quando quiser", não "faculta-se ao
   titular a revogação".
2. **Nada de "podemos vir a compartilhar".** Ou compartilha, ou não. Aqui não
   compartilha, então o texto diz isso.
3. **A cláusula de reprocessamento não pode sair.** É a seção 5. Sem ela, trocar
   o modelo de reconhecimento obriga a recolher consentimento de todo mundo de
   novo — mil pessoas, uma por uma.
4. **`consent_version` acompanha este arquivo.** Qualquer alteração de conteúdo
   sobe a versão; alteração de vírgula não.

**Versão atual: `refeitorio-facial-v1`**

---

## Texto — tela de adesão

> ### Reconhecer seu rosto no refeitório
>
> Você está sendo convidado a usar o **reconhecimento facial** para ser
> identificado no refeitório, no lugar de passar o crachá.
>
> **Isso é opcional.** Se você não quiser, continua usando o QR Code do crachá,
> do mesmo jeito que hoje. Não muda nada para você: mesma fila, mesmo horário,
> mesma refeição. Ninguém é avisado de que você recusou.
>
> #### O que a empresa guarda
>
> Ao cadastrar, seu celular tira algumas fotos do seu rosto e as envia para o
> servidor da empresa. Lá elas são transformadas em uma **sequência de números**
> que representa seu rosto — e **as fotos são apagadas na hora, sem serem
> gravadas em nenhum lugar**.
>
> O que fica guardado é só essa sequência de números. Ela não é uma foto e não
> pode ser exibida como uma. Mas ela identifica você, então é tratada com o mesmo
> cuidado que uma foto teria.
>
> #### Para que serve
>
> Só para saber quem foi servido no refeitório, contar as refeições e distribuir
> o custo entre as áreas da empresa.
>
> **Não serve** para controlar seu ponto, sua produtividade, por onde você andou
> ou quanto tempo você ficou em algum lugar. Não existe câmera de
> reconhecimento em nenhum outro lugar além do balcão do refeitório.
>
> #### Onde fica
>
> Dentro da rede da empresa. **Não é enviado para nenhuma outra empresa, nenhum
> serviço de internet e nenhum aplicativo de terceiro.**
>
> Quando você chega no balcão, o sistema primeiro descobre sua matrícula e
> **depois** confere se o rosto é o seu. Ele nunca procura você entre todas as
> pessoas cadastradas.
>
> #### Por quanto tempo
>
> Até **30 dias depois** de você sair da empresa, quando é apagado
> automaticamente. Ou antes disso, se você desistir.
>
> #### Você pode desistir quando quiser
>
> A qualquer momento, sem explicar por quê. Basta avisar `[CANAL]`. Seus números
> são apagados e você volta a usar o crachá. Nada acontece com você por causa
> disso.
>
> Você também pode pedir para ver o que está guardado a seu respeito, ou pedir
> que seja apagado, pelo mesmo canal.
>
> #### Se a tecnologia mudar
>
> A empresa pode, no futuro, trocar o programa que reconhece rostos por um mais
> novo. Se isso acontecer, **a sequência de números guardada hoje pode ser
> recalculada pelo novo programa**, para a mesma finalidade descrita aqui e sem
> pedir fotos novas.
>
> Se a finalidade mudar — se passar a ser usada para outra coisa que não contar
> refeição — a empresa **precisa pedir sua autorização de novo**.
>
> #### Quem responde por isso
>
> `[RAZÃO SOCIAL]`, CNPJ `[CNPJ]`.
> Dúvidas, pedidos e reclamações: `[CANAL]`.
> Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).
>
> ---
>
> **[ ] Eu li, entendi e concordo** que a empresa guarde a sequência de números
> do meu rosto, nas condições acima, para me identificar no refeitório.
>
> `[ Concordar e cadastrar meu rosto ]`   `[ Não quero — continuo com o crachá ]`

---

## Notas para quem for revisar

**A seção "Se a tecnologia mudar" é a que não pode ser removida.** Ela autoriza o
*reprocessamento* do vetor por um modelo futuro, mantida a finalidade. Sem ela, a
primeira troca de modelo — que é evento técnico ordinário — vira campanha de
recoleta de consentimento com mil pessoas. Com ela, o desenvolvimento dispara o
link de novo apenas para quem quiser recadastrar por outro motivo.

Ela é redigida de forma estreita de propósito: autoriza **recalcular**, para a
**mesma finalidade**. Mudança de finalidade continua exigindo novo
consentimento, e o texto diz isso na frase seguinte.

**O botão de recusa é explícito e tem o mesmo peso visual do de aceitar.** Não é
detalhe de design: uma tela em que recusar exige procurar o link pequeno no pé da
página é o tipo de coisa que transforma consentimento formalmente válido em
consentimento materialmente viciado.

**Nenhum documento é pedido.** Não se pede CPF nem RG para autorizar almoço — dois
números de documento para essa finalidade esbarra no princípio da necessidade
(art. 6º, III). A confirmação de identidade no autocadastro usa **data de
nascimento**, que já está no cadastro de pessoal, com o token individual do link
fazendo o trabalho de garantir que a pergunta chegou à pessoa certa.

**O que ainda falta preencher:** `[RAZÃO SOCIAL]`, `[CNPJ]` e `[CANAL]`. O canal
é a decisão pendente mais concreta — sem um endereço real para revogação e
pedidos de acesso, a seção "Você pode desistir quando quiser" é promessa sem
destinatário.

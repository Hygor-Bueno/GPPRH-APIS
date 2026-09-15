/**
 * @fileoverview Códigos de permissão do miepp.
 *
 * A gestão de acesso deste módulo é a MESMA do resto do sistema: `_permissions`
 * ligadas a `_roles`, concedidas por `_user_roles`, avaliadas pelo
 * `permission.middleware` (`canAny` / `canAll`) sobre `req.user.permissions`.
 *
 * ─── Por que não existe tabela de usuário do miepp ───────────────────────────
 * O schema original do módulo trazia um `miepp_users` com `role`
 * (`admin`/`editor`/`viewer`) e senha própria. Foi removido em 15/09/2026: era
 * um segundo cadastro de pessoas convivendo com o `_user`, e a concessão de
 * acesso passava a ter dois lugares que podiam discordar — quem tivesse a
 * aplicação liberada em `_application_access` mas nenhuma linha no módulo veria
 * o menu e tomaria 403 em tudo. Aconteceu de fato: 13 pessoas nessa situação.
 * Centralizar é a regra da casa. Ver `docs/miepp.md`.
 *
 * Os três níveis do requisito viraram três códigos, na granularidade do EPP:
 *
 * | Requisito | Código         | Alcance                                        |
 * |-----------|----------------|------------------------------------------------|
 * | viewer    | `MIEPP_USE`    | leitura de tudo no módulo                      |
 * | editor    | `MIEPP_EDIT`   | CRUD de locais, players, grupos, mídia,        |
 * |           |                | playlists, agendamentos e envio de comandos    |
 * | admin     | `MIEPP_MANAGE` | desativar player, gerar/revogar token de       |
 * |           |                | dispositivo e ler a trilha de auditoria        |
 *
 * Os códigos não são hierárquicos por si — quem decide é a lista passada ao
 * `canAny` em cada rota. `SYSTEM_OWNER` mantém o bypass total do middleware.
 *
 * @module modules/global/domain/miepp/miepp-access.rules
 */

/** Leitura de qualquer recurso do módulo. */
const MIEPP_USE = 'MIEPP_USE';

/** Criação e edição de conteúdo (locais, players, grupos, mídia, playlists, agendamentos, comandos). */
const MIEPP_EDIT = 'MIEPP_EDIT';

/** Administração: desativar player, gerar/revogar token de dispositivo, auditoria. */
const MIEPP_MANAGE = 'MIEPP_MANAGE';

/**
 * Quem pode LER. Qualquer um dos três serve: quem edita ou administra também
 * consulta, e exigir `MIEPP_USE` junto obrigaria a conceder duas permissões
 * para o caso mais comum.
 */
const CAN_READ = Object.freeze([MIEPP_USE, MIEPP_EDIT, MIEPP_MANAGE]);

/** Quem pode ESCREVER conteúdo. */
const CAN_WRITE = Object.freeze([MIEPP_EDIT, MIEPP_MANAGE]);

/** Quem pode ADMINISTRAR. */
const CAN_ADMINISTER = Object.freeze([MIEPP_MANAGE]);

/** Todos os códigos do módulo — usado pelo seed e pela documentação. */
const ALL_PERMISSIONS = Object.freeze([MIEPP_USE, MIEPP_EDIT, MIEPP_MANAGE]);

module.exports = {
    MIEPP_USE,
    MIEPP_EDIT,
    MIEPP_MANAGE,
    CAN_READ,
    CAN_WRITE,
    CAN_ADMINISTER,
    ALL_PERMISSIONS,
};

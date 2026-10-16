/**
 * @fileoverview Códigos de permissão do CPPP (Controle de Ponto Peg Pese).
 *
 * Mesmo modelo do resto do sistema: `_permissions` ligadas a `_roles`,
 * avaliadas por `canAny` sobre `req.user.permissions`. `SYSTEM_OWNER` mantém o
 * bypass do middleware.
 *
 * | Código         | Alcance                                                      |
 * |----------------|--------------------------------------------------------------|
 * | `CPPP_USE`     | ver inconsistências, marcações, ajustes e histórico de coleta |
 * | `CPPP_ADJUST`  | lançar e cancelar ajuste; abrir anexo (atestado)             |
 * | `CPPP_COLLECT` | cadastrar/editar relógio (IP), disparar coleta, baixar o AFD |
 *
 * ⚠️ Quem cadastra relógio escolhe o IP para onde o servidor manda a senha
 *    compartilhada de todos os relógios. A API restringe a IP da rede interna
 *    (`device.rules`), mas `CPPP_COLLECT` deve ficar com poucas pessoas.
 *
 * Papéis do seed (`GIPP-SQL/cppp-deploy.sql`): `CPPP_RH` recebe USE + ADJUST;
 * `CPPP_MANAGER` recebe os três.
 *
 * ⚠️ Não existe permissão que escreva no relógio nem que altere
 * `cppp_afd_records` — não porque falte papel, mas porque não há rota para
 * isso. Ver `docs/cppp.md`, "Restrição inegociável".
 *
 * @module modules/global/domain/cppp/cppp-access.rules
 */

const CPPP_USE = 'CPPP_USE';
const CPPP_ADJUST = 'CPPP_ADJUST';
const CPPP_COLLECT = 'CPPP_COLLECT';

/** Quem pode LER. Quem lança ajuste ou coleta também consulta. */
const CAN_READ = Object.freeze([CPPP_USE, CPPP_ADJUST, CPPP_COLLECT]);

/**
 * Quem pode lançar/cancelar ajuste e abrir o anexo. O anexo fica aqui, e não em
 * `CAN_READ`, porque atestado é dado de saúde (LGPD, art. 11): quem só
 * acompanha a tela não precisa ler o documento.
 */
const CAN_ADJUST = Object.freeze([CPPP_ADJUST]);

/** Quem pode cadastrar relógio, disparar coleta e baixar o AFD bruto (registro fiscal). */
const CAN_COLLECT = Object.freeze([CPPP_COLLECT]);

const ALL_PERMISSIONS = Object.freeze([CPPP_USE, CPPP_ADJUST, CPPP_COLLECT]);

module.exports = {
    CPPP_USE,
    CPPP_ADJUST,
    CPPP_COLLECT,
    CAN_READ,
    CAN_ADJUST,
    CAN_COLLECT,
    ALL_PERMISSIONS,
};

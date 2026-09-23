/**
 * @fileoverview A costura entre salvar o estilo e a imagem sair redesenhada.
 *
 * Os dois lados já têm teste próprio: `grid-style.rules.test` prova que o
 * estilo entra na digital, e `miepp-grid-render.use-cases.test` prova que o
 * ciclo decide certo a partir dela. O que ninguém cobria é a EMENDA — o PUT do
 * painel gravando, e o ciclo seguinte lendo o que foi gravado.
 *
 * É exatamente onde um chamado de 21/09/2026 afirmava estar o defeito ("mudar a
 * cor salva, mas a imagem nunca muda"). O relato não se confirmou, e este
 * arquivo existe para que a próxima suspeita seja respondida por um teste em
 * vez de por uma leitura de código: ele reproduz o caminho inteiro, do corpo do
 * PUT até a linha da trilha.
 *
 * ─── Por que o template REAL entra aqui ──────────────────────────────────────
 *
 * O checksum do falso armazenamento é o SHA-256 do HTML que o template de
 * verdade produz — é o que o `FileService` faz com o binário. Sem isso o teste
 * passaria mesmo que o template ignorasse o estilo por completo: a digital
 * mudaria, o ciclo renderizaria, e a imagem sairia idêntica. Com isso, "a
 * imagem mudou" é afirmação verificada, e não suposição.
 */

const crypto = require('crypto');

const { MieppProductGridUseCases } = require('../product-grid/miepp-product-grid.use-cases');
const { MieppGridRenderUseCases } = require('../product-grid/miepp-grid-render.use-cases');
const { renderGridHtml } = require('../../../../../templates/miepp-grid/grid.template');

/** Linha como o Oracle devolve. O preço NÃO muda em nenhum teste daqui. */
const LINHAS = [
    { PLU: 100, DESCRIPTION: 'ARROZ TIPO 1 5KG', BARCODE: '789', PRICE: 24.9, PRICE_PROMOTION: 0 },
    { PLU: 200, DESCRIPTION: 'FEIJAO CARIOCA 1KG', BARCODE: '790', PRICE: 8.49, PRICE_PROMOTION: 0 },
];

/**
 * Banco de mentira com a MESMA disciplina do adapter MySQL, nos dois pontos que
 * decidem este caso:
 *
 *  - `update` grava o estilo como texto JSON e zera o `data_hash`, igual ao
 *    `SQL_UPDATE_GRID`;
 *  - toda leitura devolve a coluna já desserializada, igual ao `withParsedStyle`.
 *
 * Errar qualquer um dos dois aqui faria o teste provar algo que a produção não
 * faz.
 */
function bancoFake() {
    const linha = {
        id: 1,
        media_id: 42,
        media_uuid: 'uuid-da-grade',
        media_status: 'processing',
        duration_seconds: 15,
        title: 'Seca salgada',
        shop_id: 2,
        background_file_id: null,
        grid_columns: 2,
        grid_rows: 1,
        stale_after_minutes: 30,
        style: null,
        data_hash: null,
        last_checked_at: null,
        last_rendered_at: null,
        last_error: null,
        stale: 1,
        active: 1,
        created_by: 7,
        created_at: null,
        updated_at: null,
    };

    let itens = [
        { plu: 100, order_index: 0, label_override: null },
        { plu: 200, order_index: 1, label_override: null },
    ];

    const trilha = [];
    const midia = { checksum: null, file_id: null, status: 'processing' };

    const lido = () => ({
        ...linha,
        style: linha.style === null ? null : JSON.parse(linha.style),
    });

    const repository = {
        findById: async () => lido(),
        findItems: async () => itens.map(item => ({ ...item })),
        listToRender: async () => [lido()],

        update: async (_id, payload) => {
            linha.shop_id = payload.shop_id;
            linha.grid_columns = payload.grid_columns;
            linha.grid_rows = payload.grid_rows;
            linha.stale_after_minutes = payload.stale_after_minutes;
            linha.active = payload.active;
            linha.title = payload.title;
            linha.duration_seconds = payload.duration_seconds;
            linha.style = JSON.stringify(payload.style);
            linha.data_hash = null;
            itens = payload.items.map(item => ({ ...item }));
        },

        markRendered: async (_id, dataHash) => { linha.data_hash = dataHash; },
        markChecked: async () => {},
        markOffAir: async () => {},
        markFailed: async () => {},
        setMediaStatus: async (_id, status) => { midia.status = status; },
        setMediaFile: async (_id, stored) => {
            midia.checksum = stored.checksum;
            midia.file_id = stored.file_id;
            midia.status = 'ready';
        },
        insertRender: async (registro) => { trilha.push(registro); },
    };

    return { repository, trilha, midia, linha };
}

/**
 * Renderizador e armazenamento de mentira, ligados pelo conteúdo: o "binário" é
 * o HTML do template real, e o checksum é o hash dele. Reproduz a deduplicação
 * por SHA-256 do `FileService` — imagem idêntica devolve checksum idêntico, que
 * é a premissa que impede as telas de rebaixarem à toa.
 */
function renderizadorFake() {
    const renderer = {
        render: async ({ columns, rows, items, style }) => Buffer.from(
            renderGridHtml({
                columns, rows, width: 1920, height: 1080,
                backgroundDataUri: null, items, style,
            })
        ),
        open: async () => {},
        close: async () => {},
    };

    const storage = {
        save: async (file) => ({
            file_id: 900,
            mime_type: 'image/webp',
            size_bytes: file.buffer.length,
            checksum: crypto.createHash('sha256').update(file.buffer).digest('hex'),
        }),
        resolve: async () => null,
    };

    return { renderer, storage };
}

function montar() {
    const banco = bancoFake();
    const { renderer, storage } = renderizadorFake();

    return {
        ...banco,
        // O caso de uso do painel (PUT) e o do ciclo falam com a MESMA linha.
        painel: new MieppProductGridUseCases({ repository: banco.repository }),
        ciclo: new MieppGridRenderUseCases({
            repository: banco.repository,
            productSource: { findActiveProductsByPlus: async () => LINHAS },
            renderer,
            storage,
        }),
    };
}

/** Estado de quem já está no ar: um ciclo rodado, uma linha na trilha. */
async function jaNoAr(cenario) {
    const desfecho = await cenario.ciclo.runCycle(10);
    expect(desfecho.rendered).toBe(1);
    expect(cenario.trilha).toHaveLength(1);
}

describe('mudar só o estilo redesenha a imagem sozinho', () => {
    it('critério 1 — o ciclo redesenha e a trilha ganha UMA linha, com checksum e estilo novos', async () => {
        const cenario = montar();
        await jaNoAr(cenario);

        const checksumAntigo = cenario.trilha[0].checksum;

        // O PUT do painel: só o estilo, sem tocar em item nem em preço.
        await cenario.painel.update(1, { style: { price: { color: '#FFD200' } } });

        const desfecho = await cenario.ciclo.runCycle(10);

        expect(desfecho.rendered).toBe(1);
        expect(cenario.trilha).toHaveLength(2);
        expect(cenario.trilha[1].checksum).not.toBe(checksumAntigo);
        expect(cenario.trilha[1].snapshot.style.price.color).toBe('#FFD200');
        // A mídia que o player baixa precisa ter acompanhado.
        expect(cenario.midia.checksum).toBe(cenario.trilha[1].checksum);
    });

    it('critério 2 — o ciclo seguinte, sem nenhuma alteração, não registra linha', async () => {
        const cenario = montar();
        await jaNoAr(cenario);

        await cenario.painel.update(1, { style: { label: { size: 'XG' } } });
        await cenario.ciclo.runCycle(10);
        expect(cenario.trilha).toHaveLength(2);

        const desfecho = await cenario.ciclo.runCycle(10);

        expect(desfecho.unchanged).toBe(1);
        expect(desfecho.rendered).toBe(0);
        expect(cenario.trilha).toHaveLength(2);
    });

    it('os quatro blocos do estilo chegam à imagem — nenhum grupo fica sem efeito', async () => {
        // Um bloco de fora não quebra nada: ele simplesmente não muda a imagem,
        // e o usuário mexe naqueles campos para sempre sem resultado.
        const blocos = [
            ['card',     { card: { background_color: '#101820' } }],
            ['label',    { label: { size: 'XG' } }],
            ['price',    { price: { color: '#00FF00' } }],
            ['position', { position: { order: 'price-first' } }],
        ];

        for (const [nome, style] of blocos) {
            const cenario = montar();
            await jaNoAr(cenario);
            const antes = cenario.trilha[0].checksum;

            await cenario.painel.update(1, { style });
            const desfecho = await cenario.ciclo.runCycle(10);

            expect(`${nome}: ${desfecho.rendered}`).toBe(`${nome}: 1`);
            expect(`${nome}: ${cenario.trilha[1].checksum === antes}`).toBe(`${nome}: false`);
        }
    });

    it('o estilo salvo sobrevive ao ciclo — a digital não volta para o padrão', async () => {
        // Se a coluna JSON fosse lida como texto em algum ponto do caminho, o
        // domínio cairia no estilo padrão calado: a imagem sairia com a
        // aparência antiga e o `GET` continuaria mostrando a nova.
        const cenario = montar();
        await jaNoAr(cenario);

        await cenario.painel.update(1, { style: { price: { color: '#FFD200' } } });
        await cenario.ciclo.runCycle(10);

        const grade = await cenario.painel.getById(1);
        expect(grade.style.price.color).toBe('#FFD200');
        expect(cenario.trilha[1].snapshot.style.price.color).toBe('#FFD200');
    });

    it('salvar o estilo sem mudar valor nenhum mantém a digital', async () => {
        const cenario = montar();
        await jaNoAr(cenario);

        const digital = cenario.linha.data_hash;

        // Reenvia exatamente o que já está gravado, como faz o painel que
        // devolve o formulário inteiro.
        const atual = await cenario.painel.getById(1);
        await cenario.painel.update(1, { style: atual.style });
        await cenario.ciclo.runCycle(10);

        expect(cenario.linha.data_hash).toBe(digital);
        // Mesma aparência ⇒ mesmo binário ⇒ mesmo checksum: nenhuma tela
        // rebaixa a imagem por causa de um salvamento à toa.
        expect(cenario.trilha[cenario.trilha.length - 1].checksum).toBe(cenario.trilha[0].checksum);
    });
});

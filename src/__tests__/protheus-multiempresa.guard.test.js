/**
 * @fileoverview Impede que tabela do Protheus presa a uma empresa volte ao código.
 *
 * No Protheus cada empresa tem a sua própria tabela: `SRA020` é a empresa 02,
 * `SRA060` a 06, e o mesmo vale para o centro de custo (`CTT010`…`CTT090`).
 * Escrever `TMPPRD12.dbo.SRA020` numa query parece inofensivo e passa em todo
 * teste — porque quase todo mundo está na empresa 02 —, mas silenciosamente
 * exclui as outras seis.
 *
 * Foi assim que a filial 0601 (JOBAL, empresa 06) passou meses imprimindo recibo
 * sem nome e com função "Prestador de Serviço" para colaborador CLT: o
 * `LEFT JOIN SRA020` nunca casava e os `ISNULL` assumiam o texto padrão. Com
 * `INNER JOIN` o efeito é pior — o registro não fica errado, desaparece.
 *
 * O caminho recomendado é `GIPP.dbo.view_employee_with_company_info`, que unifica
 * as sete tabelas, aplica o filtro de exclusão do Protheus e ainda traz o centro
 * de custo (dispensando o join em CTT).
 *
 * Este teste falha quando uma tabela por empresa aparece fora da allowlist. Ao
 * migrar um dos arquivos listados, remova a linha correspondente daqui.
 */

const fs   = require('fs');
const path = require('path');

/** Tabelas do Protheus que existem uma por empresa. */
const PER_COMPANY_TABLE = /\b(?:SRA|CTT)0\d0\b/g;

/**
 * Arquivos que referenciam as tabelas direto, e por que isso é aceito neles.
 *
 * Levantado em 31/08/2026. Nenhum dos dois está preso a uma única empresa — os
 * dois fazem UNION das sete tabelas, que é o mesmo que a view faz:
 *
 * - `cost-center.queries.js` **não pode** usar a view: suas queries rodam no pool
 *   `config/protheus`, cujo usuário não tem permissão no banco GIPP ("The server
 *   principal is not able to access the database GIPP"). O UNION é a única saída
 *   sem mexer em permissão de banco.
 *
 * - `meal-enroll.queries.js` roda no pool do GIPP, então poderia usar a view.
 *   Fica como melhoria, não correção.
 */
const CONHECIDOS = new Set([
    'src/modules/meal/repositories/sqlserver/meal-enroll.queries.js',
    'src/modules/protheus/repositories/cost-center.queries.js',
]);

const RAIZ = path.resolve(__dirname, '..');

/**
 * Remove comentários antes de procurar a tabela.
 *
 * A regra é sobre consultar a tabela, não sobre citar o nome dela: os comentários
 * que explicam este próprio defeito precisam poder dizer "SRA020" sem virar
 * violação. Cobre bloco (JSDoc incluído), `//` do JS e `--` do SQL dentro das
 * template strings.
 */
function semComentarios(codigo) {
    return codigo
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .split('\n')
        .map(linha => linha.replace(/\/\/.*$/, '').replace(/--.*$/, ''))
        .join('\n');
}

function listarArquivosJs(dir, encontrados = []) {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        const completo = path.join(dir, entrada.name);
        if (entrada.isDirectory()) {
            if (entrada.name !== 'node_modules') listarArquivosJs(completo, encontrados);
        } else if (entrada.name.endsWith('.js')) {
            encontrados.push(completo);
        }
    }
    return encontrados;
}

/** Caminho relativo à raiz do projeto, sempre com `/`, para casar com a allowlist. */
function caminhoRelativo(absoluto) {
    return path.relative(path.resolve(RAIZ, '..'), absoluto).split(path.sep).join('/');
}

describe('Protheus multiempresa', () => {
    const ocorrencias = [];

    beforeAll(() => {
        for (const arquivo of listarArquivosJs(RAIZ)) {
            const relativo = caminhoRelativo(arquivo);

            // Teste não gera query em produção, e mock legitimamente carrega
            // nome de tabela e de coluna do Protheus.
            if (relativo.includes('__tests__')) continue;

            const conteudo = semComentarios(fs.readFileSync(arquivo, 'utf8'));
            const achados = conteudo.match(PER_COMPANY_TABLE);
            if (achados) ocorrencias.push({ relativo, tabelas: [...new Set(achados)] });
        }
    });

    it('should not reference a per-company Protheus table in new code', () => {
        const novos = ocorrencias
            .filter(o => !CONHECIDOS.has(o.relativo))
            .map(o => `${o.relativo} (${o.tabelas.join(', ')})`);

        expect(novos).toEqual([]);
    });

    it('should keep the receipt queries free of per-company tables', () => {
        const recibos = ocorrencias.find(o =>
            o.relativo.endsWith('modules/global/repositories/sqlserver/gipp-rh.queries.js'));

        expect(recibos).toBeUndefined();
    });

    // Allowlist sem uso é allowlist que esconde: se o arquivo foi migrado ou
    // renomeado, a linha tem de sair daqui, senão o guard afrouxa em silêncio.
    it('should not keep stale entries in the allowlist', () => {
        const comOcorrencia = new Set(ocorrencias.map(o => o.relativo));
        const obsoletos = [...CONHECIDOS].filter(p => !comOcorrencia.has(p));

        expect(obsoletos).toEqual([]);
    });
});

const { GappActiveAuditReportUseCases } = require('../gapp-active-audit-report.use-cases');

const AUDIT = {
    audit_id: 15, status_audit: 2, unit_name: 'Loja <1>', dep_name: null, desc_active_class: 'Notebook',
    date_open: new Date(2026, 10, 20, 9, 5), date_finish: new Date(2026, 10, 21, 17, 0),
    user_open_name: 'Ana', user_finish_name: 'Beto',
    initial_data: { assets: [
        { active_id: 120, brand: 'Dell', model: 'G15', desc_active_class: 'Notebook', dep_path: 'Frugal > Loja 1 > TI' },
        { active_id: 121, brand: 'HP', model: null, desc_active_class: 'Notebook', dep_name: 'Caixa' },
        { active_id: 300, brand: 'Lenovo', model: 'T14', is_expected: false },
    ] },
    items: [
        { active_id_fk: 120, identifier_type: 'PATRIMONIO', identifier_value: 'P-1', asset_condition: 'GOOD', lifecycle_status: 'IN_USE', is_transfer: 0 },
        { active_id_fk: 300, identifier_type: 'SERIAL', identifier_value: 'SN9', asset_condition: 'BAD', lifecycle_status: 'IN_STOCK',
            is_transfer: 1, transfer_dep_path: 'Frugal > Loja 2 > Depósito' },
    ],
};
const REVIEW = { divergences: [{ type: 'PENDING', active_id: 121, message: 'Ativo previsto e não conferido.' }] };

function makeDeps({ audit = AUDIT, review = REVIEW } = {}) {
    const renderer = { renderPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF')) };
    const auditUseCases = { getAuditById: jest.fn().mockResolvedValue(audit), getReview: jest.fn().mockResolvedValue(review) };
    const useCases = new GappActiveAuditReportUseCases({
        auditUseCases,
        repository: { findUserNames: jest.fn().mockResolvedValue([{ user_id: 10, name: 'Carla' }]) },
        userRepository: { findAuthByAccessCode: jest.fn().mockResolvedValue({ user_id: 10, work_group_fk: 1 }) },
        renderer,
        now: () => new Date(2026, 10, 24, 8, 30),
    });
    return { useCases, renderer, auditUseCases };
}

describe('GappActiveAuditReportUseCases', () => {
    test('usa os mesmos dados (e o mesmo acesso) do detalhe e devolve o PDF com nome', async () => {
        const { useCases, renderer, auditUseCases } = makeDeps();
        const user = { id: 7 };
        const result = await useCases.generateReport('15', user);
        expect(auditUseCases.getAuditById).toHaveBeenCalledWith('15', user);
        expect(auditUseCases.getReview).toHaveBeenCalledWith('15', user);
        expect(result).toEqual({ buffer: Buffer.from('%PDF'), fileName: 'relatorio-auditoria-15.pdf' });
        const { headerTemplate, footerTemplate } = renderer.renderPdf.mock.calls[0][0];
        expect(headerTemplate).toContain('Nº 15');
        expect(footerTemplate).toContain('24/11/2026 08:30 por Carla');
    });

    test('HTML: totais, situação, transferência, divergência e texto escapado', async () => {
        const { useCases, renderer } = makeDeps();
        await useCases.generateReport(15, { id: 7 });
        const { html } = renderer.renderPdf.mock.calls[0][0];
        expect(html).toContain('Loja &lt;1&gt; · Unidade inteira');
        expect(html).toContain('<b>2</b><span>Previstos</span>');
        expect(html).toContain('<b>1</b><span>Pendentes</span>');
        expect(html).toContain('<b>1</b><span>Não previstos</span>');
        expect(html).toContain('→ Frugal &gt; Loja 2 &gt; Depósito');
        expect(html).toContain('Patrimônio P-1');
        expect(html).toContain('Divergências (1)');
        expect(html).toContain('20/11/2026 09:05 por Ana');
    });

    test('cancelada mostra o motivo no lugar das divergências', async () => {
        const { useCases, renderer } = makeDeps({ review: { canceled: true, reason: 'Inventário refeito' } });
        await useCases.generateReport(15, { id: 7 });
        expect(renderer.renderPdf.mock.calls[0][0].html).toContain('<h2>Cancelamento</h2><p>Inventário refeito</p>');
    });
});

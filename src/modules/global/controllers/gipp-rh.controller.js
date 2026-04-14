const { GippRhService } = require("../services/gipp-rh.service");
const { generateReceipt } = require("../../../templates/receipt/receipt.generator");

async function getActiveCompensations(req, res) {
    const employee = new GippRhService();
    const compensations = await employee.getActiveCompensations();
    return res.status(200).json({
        error: false,
        data: compensations
    });
};
async function postCompensations(req, res) {
    const { user, body } = req;
    const employee = new GippRhService();

    const payload = {
        name: body.name,
        description: body.description,
        active: body.active,
        created_by: user.registration,
        created_by_branch: user.branch_code
    }
    const compensations = await employee.postCompensations(payload);
    return res.status(200).json({
        error: false,
        data: compensations
    });
};
async function postBeneficiary(req, res) {
    const { user, body } = req;
    const employee = new GippRhService();

    const payload = {
        employee_id: body.employee_id,
        compensation_id: body.compensation_id,
        value: body.value,
        branch_code: body.branch_code,
        start_date: body.start_date,
        created_by: user.registration,
        updated_by: user.registration
    };

    const beneficiary = await employee.postBeneficiary(payload);

    return res.status(200).json({
        error: false,
        data: beneficiary
    });
};
async function putBeneficiary(req, res) {
    const { user, body } = req;
    const employee = new GippRhService();

    const payload = {
        id: body.id,
        employee_id: body.employee_id,
        compensation_id: body.compensation_id,
        value: body.value,
        branch_code: body.branch_code,
        start_date: body.start_date,
        created_by: user.registration,
        updated_by: user.registration
    };
    const beneficiary = await employee.putBeneficiary(payload);

    return res.status(200).json({
        error: false,
        data: beneficiary
    });
};
async function putCompensations(req, res) {
    const { user, body } = req;
    const employee = new GippRhService();

    const payload = {
        id: body.id,
        name: body.name,
        description: body.description,
        active: body.active,
        user_code: user.registration,
        branch_code: user.branch_code
    }
    const compensations = await employee.putCompensations(payload);
    return res.status(200).json({
        error: false,
        data: compensations
    });
};
async function getActiveBeneficiaries(req, res) {
    const employee = new GippRhService();
    const compensations = await employee.getActiveBeneficiaries();
    return res.status(200).json({
        error: false,
        data: compensations
    });
};
async function getEmployeesPaginated(req, res) {
    const employee = new GippRhService();

    const filters = {
        page: Number(req.query.page),
        pageSize: Number(req.query.pageSize),
        name: req.query.name,
        costCenter: req.query.costCenter,
        branch: req.query.branch,
        cnpj: req.query.cnpj,
        status: req.query.status
    };

    const data = await employee.getEmployeesPaginated(filters);

    return res.status(200).json({
        error: false,
        data
    });
}
function formatYYYYMM(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");

    return `${year}${month}`;
}
async function downloadReceipt(req, res) {
    const { employeeId, branchCode } = req.params;
    const { reference } = req.query;

    try {
        const service    = new GippRhService();
        const dataFromDB = await service.getReceiptData(employeeId, branchCode, reference, reference);

        const pdf      = await generateReceipt(dataFromDB);
        const yyyymm   = formatYYYYMM();
        const fileName = `receipt-${yyyymm}-${employeeId}.pdf`;

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
        res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
        res.send(Buffer.from(pdf));
    } catch (err) {
        console.error("[downloadReceipt]", err.message);
        res.status(err.statusCode || 500).json({
            error: true,
            message: err.message || "Error generating receipt. Please try again."
        });
    }
}

async function downloadReceiptBatch(req, res) {
    const { recipients } = req.body;

    try {
        if (!recipients?.length) {
            throw Object.assign(new Error("No recipients provided."), { statusCode: 400 });
        }

        const service    = new GippRhService();
        const dataFromDB = await service.getReceiptBatch(recipients);

        if (!dataFromDB?.length) {
            throw Object.assign(new Error("No receipts found for the provided filters."), { statusCode: 404 });
        }

        const pdf      = await generateReceipt(dataFromDB);
        const codes    = [...new Set(recipients.map(r => r.employee_code))].join('-');
        const yyyymm   = formatYYYYMM();
        const fileName = `receipts-${yyyymm}-${codes}.pdf`;

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
        res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
        res.send(Buffer.from(pdf));
    } catch (err) {
        console.error("[downloadReceiptBatch]", err.message);
        res.status(err.statusCode || 500).json({
            error: true,
            message: err.message || "Error generating receipts. Please try again."
        });
    }
}


async function getReceipt(req, res) {
    const { employeeCode, branchCode, referenceInit, referenceEnd } = req.query; // todos opcionais

    const receipt = new GippRhService();
    const data = await receipt.getReceipt(employeeCode, branchCode, referenceInit, referenceEnd);

    return res.status(200).json({
        error: false,
        data
    });

}

module.exports = {
    getActiveCompensations,
    getActiveBeneficiaries,
    postCompensations,
    putCompensations,
    postBeneficiary,
    putBeneficiary,
    getEmployeesPaginated,
    downloadReceipt,
    getReceipt,
    downloadReceiptBatch
};

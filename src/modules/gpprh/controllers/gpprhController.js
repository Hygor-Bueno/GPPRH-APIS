const { User } = require("../domain/User");
const { GpprgService } = require("../services/GpprgService");
const { JobServices } = require("../services/JobService");
const { jobValidator } = require("../valodators/jobValidator");


async function listUsers(req, res) {
    try {
        const service = new GpprgService('');
        const data = await service.getUser();
        res.status(200).json({ error: false, data: data });
    } catch (err) {
        res.status(500).json({ error: true, message: err });
    }
}

async function createJob(req, res) {
    let cod = 201;
    let message = 'success';
    try {
        // 🔹 1. Validação mínima de input (HTTP)
        if (!req.body || typeof req.body !== 'object') {
            throw new Error('Invalid request body');
        }

        jobValidator({ ...req.body, created_by: req.user?.user_id });


        // 🔹 2. Service (caso de uso)
        const service = new JobServices();
        const userId = new User(req.user).user_id;
        const result = await service.create(req.body, userId);

        // 🔹 3. Resposta HTTP
        return res.status(cod).json({
            error: false,
            message: message,
            insertId: result.insertId
        });

    } catch (err) {
        // 🔹 4. Mapeamento de erro → HTTP
        if (err.name === 'ValidationError') {
            cod = 422
        } else if (err.name === 'BadRequestError') {
            cod = 400
        } else {
            cod = 500
        };
        message = err.message || 'Internal server error'
        return res.status(cod).json({
            error: true,
            message: message
        });
    }
}

async function findAllJob(req, res) {
    let cod = 201;
    let message = 'success';
    try {
        const service = new JobServices();
        const result = await service.findAll();
        return res.status(cod).json({
            error: false,
            data: result
        });

    } catch (err) {
        // 🔹 4. Mapeamento de erro → HTTP
        if (err.name === 'ValidationError') {
            cod = 422
        } else if (err.name === 'BadRequestError') {
            cod = 400
        } else {
            cod = 500
        };
        message = err.message || 'Internal server error'
        return res.status(cod).json({
            error: true,
            message: message
        });
    }
}

module.exports = {
    listUsers,
    createJob,
    findAllJob
};
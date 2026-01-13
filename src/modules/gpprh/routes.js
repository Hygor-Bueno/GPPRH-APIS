const express = require('express');
const router = express.Router();
const authController = require('./controllers/authController');
const authMiddleware = require('../../middlewares/authMiddleware');
const GrppController = require('./controllers/gpprhController');
const {  canAll } = require('../../middlewares/authorization');

// ROTAS DE AUTENTICAÇÃO
router.get('/me', authMiddleware, authController.me);
router.post('/logout', authController.logout);
router.post('/ad-login', authController.login);
router.post('/google-login', authController.googleLogin);

// ROTAS DO BANCO GPPRH
router.post('/job', authMiddleware,canAll(['JOB_CREATE']), GrppController.createJob);
router.put('/job/:codeJob', authMiddleware,canAll(['JOB_UPDATE']), GrppController.updateJob);
router.get('/job', GrppController.findAllJob);
router.get('/job/status', authMiddleware,GrppController.listJobStatusesController);
router.get('/job-statuses', authMiddleware,GrppController.rulesJobStatus);

module.exports = router;
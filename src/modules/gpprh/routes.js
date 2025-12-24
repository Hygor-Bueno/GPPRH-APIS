const express = require('express');
const router = express.Router();
const authController = require('./controllers/authController');
const authMiddleware = require('../../middlewares/authMiddleware');
const GrppController = require('./controllers/gpprhController');
const {  canAll, canAny } = require('../../middlewares/authorization');

// ROTAS DE AUTENTICAÇÃO
router.get('/me', authMiddleware, authController.me);
router.post('/logout', authController.logout);
router.post('/ad-login', authController.login);
router.post('/google-login', authController.googleLogin);

// ROTAS DO BANCO GPPRH
router.post('/job', authMiddleware,canAll(['JOB_CREATE']), GrppController.createJob);
router.get('/job', GrppController.findAllJob);

module.exports = router;
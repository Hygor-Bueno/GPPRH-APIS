const express = require('express');
const router = express.Router();
const authController = require('./controllers/authController');
const authMiddleware = require('../../middlewares/authMiddleware');
const GrppController = require('./controllers/gpprhController');
const { canAll } = require('../../middlewares/authorization');

// 1 - ROTAS DE AUTENTICAÇÃO
// 1.1 - PUBLICA.
router.post('/logout', authController.logout);
router.post('/ad-login', authController.login);
router.post('/google-login', authController.googleLogin);
// 1.2 - PRIVADA
router.get('/me', authMiddleware, authController.me);

// 2 - ROTAS DO BANCO GPPRH
// 2.1 - ROTAS PRIVADAS:
router.post('/job', authMiddleware, canAll(['JOB_CREATE']), GrppController.createJob);
router.put('/job/', authMiddleware, canAll(['JOB_UPDATE']), GrppController.updateJob);
router.get('/job/status', authMiddleware, canAll(['JOB_STATUS_VIEW']), GrppController.listJobStatusesController);
router.get('/job-statuses', authMiddleware, canAll(['JOB_STATUS_VIEW']), GrppController.rulesJobStatus);

router.get('/job-status-rules', authMiddleware, canAll(['CANDIDATE']), GrppController.rulesJobStatus);
router.post('/job-likes', authMiddleware, canAll(['CANDIDATE']), GrppController.jobLikes);
router.post('/job-application', authMiddleware, canAll(['CANDIDATE']), GrppController.jobApplication);
router.post('/job-comments', authMiddleware, canAll(['CANDIDATE']), GrppController.jobComments);
router.get('/:codeJob/job-comments', authMiddleware, canAll(['CANDIDATE']), GrppController.jobCommentsView);

// 2.2 -  ROTAS PUBLICAS:
router.get('/job', GrppController.findAllJob);
router.get('/job/:codeCandidate', GrppController.findAllJob);

module.exports = router;
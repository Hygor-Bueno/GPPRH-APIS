const express = require('express');
const router = express.Router();
const authController = require('./controllers/auth.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const GrppController = require('./controllers/gpprh.controller');
const { canAll } = require('../../middlewares/permission.middleware');
const { asyncHandler } = require('../../middlewares/async-handler.middleware');
const { loginLimiter } = require('../../middlewares/rate-limit.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const { loginSchema } = require('../../schemas/auth.schema');
const { createJobSchema, updateJobSchema, blockUnknownJobFields, validateSalaryRange, jobLikeSchema, jobApplicationSchema, jobCommentSchema } = require('../../schemas/job.schema');

// 1 - ROTAS DE AUTENTICAÇÃO
// 1.1 - PUBLICA
router.post('/logout', asyncHandler(authController.logout));
router.post('/ad-login', loginLimiter, validate(loginSchema), asyncHandler(authController.login));
router.post('/google-login', loginLimiter, asyncHandler(authController.googleLogin)); // Google valida token via SDK
// 1.2 - PRIVADA
router.get('/me', authMiddleware, asyncHandler(authController.me));

// 2 - ROTAS DO BANCO GPPRH
// 2.1 - ROTAS PRIVADAS
router.post('/job', authMiddleware, canAll(['JOB_CREATE']), blockUnknownJobFields, validate(createJobSchema), validateSalaryRange, asyncHandler(GrppController.createJob));
router.put('/job/', authMiddleware, canAll(['JOB_UPDATE']), blockUnknownJobFields, validate(updateJobSchema), validateSalaryRange, asyncHandler(GrppController.updateJob));
router.get('/job/status', authMiddleware, canAll(['JOB_STATUS_VIEW']), asyncHandler(GrppController.listJobStatusesController));
router.get('/job-statuses', authMiddleware, canAll(['JOB_STATUS_VIEW']), asyncHandler(GrppController.rulesJobStatus));
router.get('/job-status-rules', authMiddleware, canAll(['CANDIDATE']), asyncHandler(GrppController.rulesJobStatus));
router.get('/job-contracts', authMiddleware, asyncHandler(GrppController.jobContracts));

router.post('/job-likes', authMiddleware, canAll(['CANDIDATE']), validate(jobLikeSchema), asyncHandler(GrppController.jobLikes));
router.post('/job-application', authMiddleware, canAll(['CANDIDATE']), validate(jobApplicationSchema), asyncHandler(GrppController.jobApplication));
router.get('/job-application', authMiddleware, canAll(['CANDIDATE']), asyncHandler(GrppController.viewJobApplication));
router.post('/job-comments', authMiddleware, canAll(['CANDIDATE']), validate(jobCommentSchema), asyncHandler(GrppController.jobComments));
router.get('/:codeJob/job-comments', authMiddleware, canAll(['CANDIDATE']), asyncHandler(GrppController.jobCommentsView));

// 2.2 - ROTAS PUBLICAS
router.get('/job', asyncHandler(GrppController.findAllJob));
router.get('/job/:codeCandidate', authMiddleware, asyncHandler(GrppController.viewJob));

router.get('/time-records/payment',
asyncHandler(GrppController.findAllJob));

module.exports = router;
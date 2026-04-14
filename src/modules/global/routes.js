const express = require('express');
const router = express.Router();
const authController = require('./controllers/auth.controller');
const employeeController = require('./controllers/employee.controller');
const gippRhController = require('./controllers/gipp-rh.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const upload = require('../../middlewares/upload.middleware');
const { canAll } = require('../../middlewares/permission.middleware');
// VERSÃO QUE APONTA PARA O GLOBAL.
router.get('/me',authMiddleware, authController.me);
router.post('/logout', authController.logout);
router.post('/login', authController.globalLogin);

// Rotas para Employee
router.post('/employee/:id/photo',upload.single("photo"), employeeController.postPhotoEmployee);
router.get('/employee/:id/photo', employeeController.getPhotoEmployee);

// Rotas para GIPP RH Beneficiários e Compensações
router.get('/gipp-rh/active-compensations',authMiddleware, canAll(['VIEW_GIPP_RH_BENEFITS']), gippRhController.getActiveCompensations);
router.post('/gipp-rh/active-compensations',authMiddleware, gippRhController.postCompensations);
router.put('/gipp-rh/active-compensations',authMiddleware, gippRhController.putCompensations);

// Rotas para GIPP RH Beneficiários
router.post('/gipp-rh/active-beneficiaries',authMiddleware,gippRhController.postBeneficiary);
router.get('/gipp-rh/active-beneficiaries',authMiddleware, gippRhController.getActiveBeneficiaries);
router.put('/gipp-rh/active-beneficiaries',authMiddleware,gippRhController.putBeneficiary);

router.get('/gipp-rh/employees-paginated',authMiddleware,gippRhController.getEmployeesPaginated);
router.get('/gipp-rh/receipt/:employeeId/:branchCode',authMiddleware,gippRhController.downloadReceipt);
router.post('/gipp-rh/receipt-batch',authMiddleware,gippRhController.downloadReceiptBatch);
router.get('/gipp-rh/receipt',authMiddleware,gippRhController.getReceipt);

module.exports = router;
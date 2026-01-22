const { BadRequestError } = require("../../../errors/BadRequestError");
const { UnauthorizedError } = require("../../../errors/UnauthorizedError");
const { listJobStatuses } = require("../domain/Jobs/job-status.helper");
const { User } = require("../domain/User");
const { JobStatus, ALLOWED_TRANSITIONS } = require("../schema/jobSchema");
const { GpprhService } = require("../services/GpprhService");
const { JobServices } = require("../services/JobService");
const { jobValidator } = require("../validators/jobValidator");

// 🔹 LIST USERS
async function listUsers(req, res) {
  const service = new GpprhService('');
  const data = await service.getUser();

  return res.status(200).json({
    error: false,
    data
  });
}

// 🔹 CREATE JOB
async function createJob(req, res) {
  if (!req.body || typeof req.body !== 'object') {
    throw new BadRequestError('Invalid request body');
  }

  if (!req.user) {
    throw new UnauthorizedError();
  }

  jobValidator({ ...req.body, created_by: req.user.user_id });

  const service = new JobServices();
  const userId = new User(req.user).user_id;
  const result = await service.create(req.body, userId);

  return res.status(201).json({
    error: false,
    insert_id: result.insertId
  });
}

// 🔹 UPDATE JOB
async function updateJob(req, res) {
  if (!req.body || typeof req.body !== 'object') {
    throw new BadRequestError('Invalid request body');
  }

  jobValidator(
    { ...req.body, created_by: req.user?.user_id },
    { mode: 'update' }
  );

  const service = new JobServices();
  await service.update(req.body);

  return res.status(200).json({
    error: false,
    message: 'Sucesso!'
  });
}

// 🔹 FIND ALL JOBS
async function findAllJob(req, res) {
  const service = new JobServices();
  const result = await service.findAll();

  return res.status(200).json({
    error: false,
    data: result
  });
}

// 🔹 LIST JOB STATUSES
async function listJobStatusesController(req, res) {
  return res.status(200).json({
    error: false,
    data: listJobStatuses()
  });
}

// 🔹 RULES JOB STATUS
async function rulesJobStatus(req, res) {
  return res.status(200).json({
    error: false,
    data: {
      enum: Object.values(JobStatus),
      allowedTransitions: ALLOWED_TRANSITIONS,
      version: 1
    }
  });
}

module.exports = {
  listUsers,
  createJob,
  updateJob,
  findAllJob,
  listJobStatusesController,
  rulesJobStatus
};

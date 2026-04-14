const { BadRequestError } = require("../../../errors/bad-request.error");
const { UnauthorizedError } = require("../../../errors/unauthorized.error");
const { JobStatus } = require("../domain/jobs/job-status.enum");
const { listJobStatuses } = require("../domain/jobs/job-status.helper");
const { ALLOWED_TRANSITIONS } = require("../domain/jobs/job-status.transitions");
const { JOB_INPUT_FIELDS } = require("../domain/jobs/job.contract");
const { User } = require("../domain/user.entity");
const { GpprhService } = require("../services/gpprh.service");
const { JobServices } = require("../services/job.service");
const { jobValidator } = require("../validators/job.validator");

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
// 🔹 FIND ALL JOBS
async function viewJob(req, res) {
  const service = new JobServices();
  const result = await service.findAll(req.user.user_id);
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

async function jobLikes(req, res) {
  const service = new JobServices();
  const { job_id, candidate_id } = req.body;
  const data = await service.postLike(job_id, candidate_id);

  return res.status(200).json({
    error: false,
    data
  });
}

async function jobApplication(req, res) {
  const service = new JobServices();
  const { job_id, candidate_id } = req.body;
  const data = await service.postJobApplication(job_id, candidate_id);
  return res.status(200).json({
    error: false,
    data
  });
}
async function viewJobApplication(req, res) {
  if (!req.user) {
    throw new UnauthorizedError('Not authenticated');
  }
  const service = new JobServices();
  const data = await service.getJobApplication(req.user.user_id);
  return res.status(200).json({
    error: false,
    data
  });
}

async function jobComments(req, res) {
  const service = new JobServices();
  const { job_id, candidate_id, comment } = req.body;
  const data = await service.postComments(job_id, candidate_id, comment);
  return res.status(200).json({
    error: false,
    data
  });
}

async function jobCommentsView(req, res) {
  const service = new JobServices();
  const { codeJob } = req.params;
  const data = await service.getAllComments(codeJob);
  return res.status(200).json({
    error: false,
    data
  });
}
// 🔹 CONTRACTS JOB
async function jobContracts(req, res) {
  return res.status(200).json({
    error: false,
    data: {
      fields: JOB_INPUT_FIELDS,
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
  rulesJobStatus,
  jobLikes,
  jobApplication,
  viewJobApplication,
  jobComments,
  jobCommentsView,
  viewJob,
  jobContracts
};

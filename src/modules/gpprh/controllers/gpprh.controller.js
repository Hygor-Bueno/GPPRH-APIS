const { UnauthorizedError } = require("../../../errors/unauthorized.error");
const { JobStatus } = require("../domain/jobs/job-status.enum");
const { listJobStatuses } = require("../domain/jobs/job-status.helper");
const { ALLOWED_TRANSITIONS } = require("../domain/jobs/job-status.transitions");
const { JOB_INPUT_FIELDS } = require("../domain/jobs/job.contract");
const { User } = require("../domain/user.entity");
const { GpprhService } = require("../services/gpprh.service");
const { JobServices } = require("../services/job.service");
const { respond } = require("../../../utils/respond");

// 🔹 LIST USERS
async function listUsers(req, res) {
  const service = new GpprhService('');
  const data = await service.getUser();
  return respond.ok(res, data);
}

// 🔹 CREATE JOB
async function createJob(req, res) {
  const service = new JobServices();
  const userId = new User(req.user).user_id;
  const result = await service.create(req.body, userId);
  return respond.created(res, { insertId: result.insertId });
}

// 🔹 UPDATE JOB
async function updateJob(req, res) {
  const service = new JobServices();
  await service.update(req.body);
  return respond.message(res, 'Updated successfully');
}

// 🔹 FIND ALL JOBS (público)
async function findAllJob(req, res) {
  const service = new JobServices();
  const data = await service.findAll();
  return respond.ok(res, data);
}

// 🔹 FIND ALL JOBS (candidato autenticado — inclui liked_by_me)
async function viewJob(req, res) {
  const service = new JobServices();
  const data = await service.findAll(req.user.user_id);
  return respond.ok(res, data);
}

// 🔹 LIST JOB STATUSES
async function listJobStatusesController(req, res) {
  return respond.ok(res, listJobStatuses());
}

// 🔹 RULES JOB STATUS
async function rulesJobStatus(req, res) {
  return respond.ok(res, {
    enum: Object.values(JobStatus),
    allowedTransitions: ALLOWED_TRANSITIONS,
    version: 1
  });
}

async function jobLikes(req, res) {
  const service = new JobServices();
  const { job_id, candidate_id } = req.body;
  const data = await service.postLike(job_id, candidate_id);
  return respond.ok(res, data);
}

async function jobApplication(req, res) {
  const service = new JobServices();
  const { job_id, candidate_id } = req.body;
  const data = await service.postJobApplication(job_id, candidate_id);
  return respond.ok(res, data);
}

async function viewJobApplication(req, res) {
  if (!req.user) throw new UnauthorizedError('Not authenticated');
  const service = new JobServices();
  const data = await service.getJobApplication(req.user.user_id);
  return respond.ok(res, data);
}

async function jobComments(req, res) {
  const service = new JobServices();
  const { job_id, candidate_id, comment } = req.body;
  const data = await service.postComments(job_id, candidate_id, comment);
  return respond.ok(res, data);
}

async function jobCommentsView(req, res) {
  const service = new JobServices();
  const { codeJob } = req.params;
  const data = await service.getAllComments(codeJob);
  return respond.ok(res, data);
}

// 🔹 CONTRACTS JOB
async function jobContracts(req, res) {
  return respond.ok(res, { fields: JOB_INPUT_FIELDS, version: 1 });
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

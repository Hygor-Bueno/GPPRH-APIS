const { JobStatus } = require('./job-status.enum');

const ALLOWED_TRANSITIONS = Object.freeze({
  [JobStatus.DRAFT]: [JobStatus.OPEN, JobStatus.CANCELLED],
  [JobStatus.OPEN]: [JobStatus.PAUSED, JobStatus.CLOSED, JobStatus.CANCELLED],
  [JobStatus.PAUSED]: [JobStatus.OPEN, JobStatus.CANCELLED],
  [JobStatus.CLOSED]: [],
  [JobStatus.CANCELLED]: [],
});

module.exports = { ALLOWED_TRANSITIONS };

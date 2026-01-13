const JOB_FIELDS = {
    id: { required: false },
    opened_at: { required: false },
    closed_at: { required: false },
    branch_cod: { required: true },
    branch_name: { required: true },
    position_cod: { required: true },
    position_name: { required: true },
    description: { required: true },
    salary_min: { required: true },
    salary_max: { required: true },
    location: { required: true },
    created_by: { required: true },
    status: { required: false }
};

const SQL_FIELDS = Object.keys(JOB_FIELDS);

const JobStatus = Object.freeze({
  DRAFT: 'DRAFT',
  OPEN: 'OPEN',
  PAUSED: 'PAUSED',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
});

const ALLOWED_TRANSITIONS = Object.freeze({
  [JobStatus.DRAFT]: [JobStatus.OPEN, JobStatus.CANCELLED],
  [JobStatus.OPEN]: [JobStatus.PAUSED, JobStatus.CLOSED, JobStatus.CANCELLED],
  [JobStatus.PAUSED]: [JobStatus.OPEN, JobStatus.CANCELLED],
  [JobStatus.CLOSED]: [],
  [JobStatus.CANCELLED]: [],
});

module.exports = {
    JOB_FIELDS,
    SQL_FIELDS,
    ALLOWED_TRANSITIONS,
    JobStatus
};

const { AppError } = require('../../../../errors/AppError');
const { JobStatus } = require('./job-status.enum');

class Jobs {
  id;
  status;
  opened_at;
  closed_at;

  constructor(data) {
    this.assign(data);
    this.applyDefaults();
    this.normalize();
    this.validateTypes();
    this.validateBusinessRules();
  }

  assign(data = {}) {
    this.branch_name = data.branch_name;
    this.branch_cod = data.branch_cod;
    this.position_cod = data.position_cod;
    this.position_name = data.position_name;
    this.description = data.description;
    this.location = data.location;
    this.created_by = data.created_by;
    this.salary_min = data.salary_min;
    this.salary_max = data.salary_max;
    this.id = data.id;
    this.status = data.status;
    this.closed_at = data.closed_at;
    this.opened_at = data.opened_at;
  }

  applyDefaults() {
    if (this.status == null) {
      this.status = JobStatus.DRAFT;
    }
  }

  normalize() {
    this.branch_name = this.branch_name?.trim();
  }

  validateTypes() {
    if (!Object.values(JobStatus).includes(this.status)) {
      throw new AppError(
        `Invalid job status: ${this.status}`,
        422,
        { code: 'JOB_STATUS_INVALID' }
      );
    }

    if (
      (this.salary_min != null && Number.isNaN(Number(this.salary_min))) ||
      (this.salary_max != null && Number.isNaN(Number(this.salary_max)))
    ) {
      throw new AppError(
        'Salary must be a valid number',
        422,
        { code: 'JOB_SALARY_INVALID' }
      );
    }
  }

  validateBusinessRules() {
    if (
      this.salary_min != null &&
      this.salary_max != null &&
      Number(this.salary_max) < Number(this.salary_min)
    ) {
      throw new AppError(
        'Salary max cannot be lower than salary min',
        422,
        { code: 'JOB_SALARY_RANGE_INVALID' }
      );
    }
  }

  isAllowedTransition(from, to, allowed = []) {
    if (!allowed.includes(to)) {
      throw new AppError(
        `Invalid status transition: ${from} → ${to}`,
        409,
        {
          code: 'JOB_STATUS_TRANSITION_NOT_ALLOWED',
          details: { from, to }
        }
      );
    }
  }

  /**
   * Valida se a transição de status é permitida
   * @param {string} originalStatus - status atual vindo do banco
   */
  validateStatusJob(originalStatus) {
    const validStatuses = Object.values(JobStatus);

    if (!validStatuses.includes(originalStatus)) {
      throw new AppError(
        `Invalid original job status: ${originalStatus}`,
        422,
        {
          code: 'JOB_STATUS_ORIGINAL_INVALID',
          details: { currentStatus: originalStatus }
        }
      );
    }

    if (!validStatuses.includes(this.status)) {
      throw new AppError(
        `Invalid target job status: ${this.status}`,
        422,
        {
          code: 'JOB_STATUS_TARGET_INVALID',
          details: { targetStatus: this.status }
        }
      );
    }

    if (originalStatus === this.status) {
      throw new AppError(
        `Job is already in status ${originalStatus}`,
        409,
        {
          code: 'JOB_STATUS_NO_CHANGE',
          details: { currentStatus: originalStatus }
        }
      );
    }

    const allowedTransitions = {
      [JobStatus.DRAFT]: [JobStatus.OPEN, JobStatus.CANCELLED],
      [JobStatus.OPEN]: [JobStatus.PAUSED, JobStatus.CLOSED, JobStatus.CANCELLED],
      [JobStatus.PAUSED]: [JobStatus.OPEN, JobStatus.CANCELLED],
    };

    if ([JobStatus.CLOSED, JobStatus.CANCELLED].includes(originalStatus)) {
      throw new AppError(
        `Job with status ${originalStatus} cannot be changed`,
        409,
        {
          code: 'JOB_STATUS_FINAL',
          details: { currentStatus: originalStatus }
        }
      );
    }

    this.isAllowedTransition(
      originalStatus,
      this.status,
      allowedTransitions[originalStatus]
    );

    this.applyStatusSideEffects();
  }

  applyStatusSideEffects() {
    const now = new Date();

    if (this.status === JobStatus.OPEN && !this.opened_at) {
      this.opened_at = this.toMysqlDatetime(now);
    }

    if (this.status === JobStatus.CLOSED && !this.closed_at) {
      this.closed_at = this.toMysqlDatetime(now);
    }
  }

  toMysqlDatetime(date) {
    if (!date) return null;

    if (date instanceof Date) {
      return date.toISOString().slice(0, 23).replace('T', ' ');
    }

    if (typeof date === 'string') {
      return date.replace('T', ' ').replace('Z', '').slice(0, 23);
    }

    return null;
  }
}

module.exports = { Jobs };

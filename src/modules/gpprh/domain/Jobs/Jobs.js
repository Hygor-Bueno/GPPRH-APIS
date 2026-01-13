const { JobStatus } = require('./job-status.enum');

class Jobs {
  id = undefined;
  status = undefined;
  opened_at = undefined;
  closed_at = undefined;

  constructor(data) {
    this.assign(data);
    this.applyDefaults();      // defaults antes das validações
    this.normalize();
    this.validateTypes();
    this.validateBusinessRules();
  }

  assign(data) {
    this.branch_name = data.branch_name;
    this.branch_cod = data.branch_cod;
    this.position_cod = data.position_cod;
    this.position_name = data.position_name;
    this.description = data.description;
    this.location = data.location;
    this.created_by = data.created_by;
    this.salary_min = data.salary_min;
    this.salary_max = data.salary_max;
    this.id = data.id; // pode ser undefined
    this.status = data.status; // pode ser undefined
    this.closed_at = data.closed_at;
    this.opened_at = data.opened_at;
  }

  applyDefaults() {
    if (this.status == null) {
      this.status = JobStatus.DRAFT;
    }
  }

  normalize() {
    // exemplo de normalizações futuras
    this.branch_name = this.branch_name?.trim();
  }

  validateTypes() {
    if (!Object.values(JobStatus).includes(this.status)) {
      throw new Error(`Invalid job status: ${this.status}`);
    }

    if (Number.isNaN(this.salary_min) || Number.isNaN(this.salary_max)) {
      throw new Error('Salary must be a valid number');
    }
  }

  validateBusinessRules() {
    if (this.salary_max < this.salary_min) {
      throw new Error('Salary max cannot be lower than salary min');
    }
  }

  isAllowedTransition(from, to, allowed) {
    if (!allowed.includes(to)) {
      throw new Error(`Invalid status transition: ${from} → ${to}`);
    }
  }

  /**
   * Valida se a transição de status é permitida
   * @param {string} originalStatus - status atual vindo do banco
  */
  validateStatusJob(originalStatus) {
    // 🔹 1. Valida se os status existem no enum
    const validStatuses = Object.values(JobStatus);

    if (!validStatuses.includes(originalStatus)) {
      throw new Error(`Invalid original job status: ${originalStatus}`);
    }

    if (!validStatuses.includes(this.status)) {
      throw new Error(`Invalid target job status: ${this.status}`);
    }

    // 🔹 2. Não permite transição para o mesmo status
    if (originalStatus === this.status) {
      throw new Error(`Job is already in status ${originalStatus}`);
    }

    // 🔹 3. Mapa de transições permitidas
    const allowedTransitions = {
      [JobStatus.DRAFT]: [JobStatus.OPEN, JobStatus.CANCELLED],
      [JobStatus.OPEN]: [JobStatus.PAUSED, JobStatus.CLOSED, JobStatus.CANCELLED],
      [JobStatus.PAUSED]: [JobStatus.OPEN, JobStatus.CANCELLED],
    };

    // 🔹 4. Status finais não podem mudar
    if ([JobStatus.CLOSED, JobStatus.CANCELLED].includes(originalStatus)) {
      throw new Error(`Job with status ${originalStatus} cannot be changed`);
    }

    // 🔹 5. Valida a transição
    this.isAllowedTransition(
      originalStatus,
      this.status,
      allowedTransitions[originalStatus]
    );
    this.applyStatusSideEffects();
  }

  applyStatusSideEffects() {
    const now = new Date(); // hora do servidor
    if (this.status === JobStatus.OPEN && !this.opened_at) {
      this.opened_at = this.toMysqlDatetime(now);
    }
    if (this.status === JobStatus.CLOSED && !this.closed_at) {
      this.closed_at = this.toMysqlDatetime(now);
    }
  }

  toMysqlDatetime(date) {
    if (date) {
      if (date instanceof Date) {
        return date.toISOString().slice(0, 23).replace('T', ' ');
      }
      // se vier string ISO
      if (typeof date === 'string') {
        return date.replace('T', ' ').replace('Z', '').slice(0, 23);
      }
    }
  }


}

module.exports = { Jobs };

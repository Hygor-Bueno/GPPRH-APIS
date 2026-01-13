const { JobStatus } = require('./job-status.enum');

const JOB_STATUS_META = Object.freeze({
  [JobStatus.DRAFT]: {
    label: ['Não publicar', 'Criada'],
    color: "#6B7280",
    isFinal: false,
  },
  [JobStatus.OPEN]: {
    label: ['Publicar vaga', 'Aberta'],
    color: "#10B981",
    isFinal: false,
  },
  [JobStatus.PAUSED]: {
    label: ['Pausar vaga', 'Pausada'],
    color: "#F59E0B",
    isFinal: false,
  },
  [JobStatus.CLOSED]: {
    label: ['Finalizar vaga', 'Encerrada'],
    color: "#3B82F6",
    isFinal: true,
  },
  [JobStatus.CANCELLED]: {
    label: ['Cancelar vaga', 'Cancelada'],
    color: "#EF4444",
    isFinal: true,
  },
});

module.exports = { JOB_STATUS_META };

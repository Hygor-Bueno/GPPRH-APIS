const { JOB_STATUS_META } = require('./job-status.meta');

function listJobStatuses() {
  return Object.entries(JOB_STATUS_META).map(([key, meta]) => ({
    key,
    label: meta.label,
    color: meta.color,
  }));
}

module.exports = {
  listJobStatuses,
};

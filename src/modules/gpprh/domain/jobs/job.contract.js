const { JOB_FIELDS } = require('./job.fields');

const JOB_INPUT_FIELDS = Object.freeze(
  Object.fromEntries(
    Object.entries(JOB_FIELDS).filter(([key]) =>
      !['id', 'opened_at', 'closed_at', 'created_by'].includes(key)
    )
  )
);

module.exports = { JOB_INPUT_FIELDS };

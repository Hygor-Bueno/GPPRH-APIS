const JOB_FIELDS = {
  id:           { required: false },
  opened_at:    { required: false },
  closed_at:    { required: false },
  branch_cod:   { required: true },
  branch_name:  { required: true },
  position_cod: { required: true },
  position_name:{ required: true },
  description:  { required: true },
  salary_min:   { required: true },
  salary_max:   { required: true },
  location:     { required: true },
  created_by:   { required: true },
  status:       { required: false },
};

module.exports = { JOB_FIELDS };

const JOB_FIELDS = {
    company_name: { required: true },
    position: { required: true },
    description: { required: true },
    salary_min: { required: true },
    salary_max: { required: true },
    location: { required: true },
    created_by: { required: true }
};

const INSERT_FIELDS = Object.keys(JOB_FIELDS);

module.exports = {
    JOB_FIELDS,
    INSERT_FIELDS
};

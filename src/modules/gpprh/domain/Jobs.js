class Jobs {
  constructor(data) {
    this.assign(data);            // 1️⃣ estado
    this.normalize();             // 2️⃣ normalização
    this.validateTypes();         // 3️⃣ tipos
    this.validateBusinessRules(); // 4️⃣ regras
  }

  // 🔹 1. Estado da entidade
  assign(data) {
    this.company_name = data.company_name;
    this.position = data.position;
    this.description = data.description;
    this.location = data.location;
    this.created_by = data.created_by;
    this.salary_min = data.salary_min;
    this.salary_max = data.salary_max;
  }

  // 🔹 2. Normalização
  normalize() {
    this.salary_min = Number(this.salary_min);
    this.salary_max = Number(this.salary_max);
  }

  // 🔹 3. Tipos
  validateTypes() {
    if (Number.isNaN(this.salary_min) || Number.isNaN(this.salary_max)) {
      throw new Error('Salary must be a valid number');
    }
  }

  // 🔹 4. Regras de negócio
  validateBusinessRules() {
    if (this.salary_max < this.salary_min) {
      throw new Error('Salary max cannot be lower than salary min');
    }
  }
}

module.exports = { Jobs };

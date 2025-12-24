const fs = require("fs");
const path = require("path");

function createDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log("📁 Criado:", dirPath);
    }
}

function createFile(filePath, content = "") {
    fs.writeFileSync(filePath, content);
    console.log("📄 Criado:", filePath);
}

const base = "gpprh/api/src";

// ==== 📂 ESTRUTURA DE PASTAS ====
const folders = [
    `${base}/config`,
    `${base}/modules/gpprh/controllers`,
    `${base}/modules/gpprh/services`,
    `${base}/modules/consinco/controllers`,
    `${base}/modules/consinco/services`,
    `${base}/modules/protheus/controllers`,
    `${base}/modules/protheus/services`,
    `${base}/modules/protheus/repositories`,
    `${base}/middlewares`,
    `${base}/utils`,
    `${base}/services`
];

// Criar diretórios
folders.forEach(createDir);

// ==== 📄 ARQUIVOS ====
const files = {
    // ROOT
    [`${base}/app.js`]: `
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const app = express();

app.use(cookieParser());

// CORS
app.use(cors({
  origin: ["http://localhost:3000", "https://vagas.gpprh.com.br"],
  credentials: true
}));

app.use(express.json());

// Debug cookies
app.use((req, res, next) => {
    console.log("Cookies recebidos:", req.cookies);
    next();
});

// Rotas
app.use("/gpprh", require("./modules/gpprh/routes"));
app.use("/protheus", require("./modules/protheus/routes"));
app.use("/consinco", require("./modules/consinco/routes"));

module.exports = app;
`,

    [`${base}/server.js`]: `
const app = require("./app");
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
    console.log("🚀 API rodando na porta", PORT);
});
`,

    // CONFIG
    [`${base}/config/ad.js`]: `module.exports = {};`,
    [`${base}/config/mysql.js`]: `module.exports = {};`,
    [`${base}/config/oracle.js`]: `module.exports = {};`,
    [`${base}/config/protheus.js`]: `module.exports = {};`,

    // SERVICES ROOT
    [`${base}/services/authService.js`]: `module.exports = {};`,

    // UTILS
    [`${base}/utils/timeParser.js`]: `module.exports = {};`,

    // MIDDLEWARE
    [`${base}/middlewares/authMiddleware.js`]: `
module.exports = (req, res, next) => {
    console.log("authMiddleware -> Cookies:", req.cookies);
    next();
};
`,

    // GPPRH
    [`${base}/modules/gpprh/controllers/adController.js`]: `
exports.login = (req, res) => {
    res.json({ message: "Login GPPRH funcionando" });
};
`,

    [`${base}/modules/gpprh/services/adService.js`]: `module.exports = {};`,

    [`${base}/modules/gpprh/routes.js`]: `
const express = require("express");
const router = express.Router();

const adController = require("./controllers/adController");

router.post("/ad-login", adController.login);

module.exports = router;
`,

    // CONSINCO
    [`${base}/modules/consinco/routes.js`]: `
const express = require("express");
const router = express.Router();

router.get("/", (req, res) => res.json({ message: "Consinco OK" }));

module.exports = router;
`,

    // PROTHEUS
    [`${base}/modules/protheus/controllers/protheusController.js`]: `
exports.test = (req, res) => {
    res.json({ message: "Protheus funcionando" });
};
`,

    [`${base}/modules/protheus/services/protheusService.js`]: `module.exports = {};`,

    [`${base}/modules/protheus/repositories/costCenterRepository.js`]: `module.exports = {};`,

    [`${base}/modules/protheus/routes.js`]: `
const express = require("express");
const router = express.Router();

const controller = require("./controllers/protheusController");

router.get("/test", controller.test);

module.exports = router;
`
};

// Criar arquivos
Object.entries(files).forEach(([file, content]) => {
    createFile(file, content.trimStart());
});

console.log("\n🎉 Estrutura criada com sucesso!");

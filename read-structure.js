const fs = require("fs");
const path = require("path");

/**
 * Pastas que NÃO devem ser analisadas
 */
const IGNORE = ["node_modules", ".git"];

/**
 * Lê recursivamente a estrutura de diretórios
 */
function scan(dir) {
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter(item => !IGNORE.includes(item.name))
        .map(item => {
            const fullPath = path.join(dir, item.name);

            if (item.isDirectory()) {
                return {
                    name: item.name,
                    type: "directory",
                    children: scan(fullPath)
                };
            }

            return {
                name: item.name,
                type: "file",
                extension: path.extname(item.name)
            };
        });
}

/**
 * Diretório base do backend
 * __dirname garante que o caminho seja sempre correto
 */
const baseDir = path.join(__dirname, "src");

// Validação de segurança
if (!fs.existsSync(baseDir)) {
    console.error("❌ Diretório não encontrado:", baseDir);
    process.exit(1);
}

// Monta a estrutura final
const structure = {
    root: path.basename(baseDir),
    generatedAt: new Date().toISOString(),
    tree: scan(baseDir)
};

// Gera o arquivo de saída
const outputFile = path.join(__dirname, "backend-structure.filtered.json");

fs.writeFileSync(
    outputFile,
    JSON.stringify(structure, null, 2)
);

console.log("✅ Estrutura do backend gerada com sucesso!");
console.log("📄 Arquivo:", outputFile);

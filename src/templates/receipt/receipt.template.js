const fs = require("fs");
const path = require("path");

const logoPath = path.resolve(__dirname, "gpp-logo-identical.svg");

const logoDataUri = `data:image/svg+xml;base64,${Buffer
  .from(fs.readFileSync(logoPath, "utf-8"))
  .toString("base64")}`;

function formatMoney(value) {
  const num =
    typeof value === "number"
      ? value
      : Number(String(value || 0).replace(",", "."));

  return "R$ " + (num || 0).toFixed(2).replace(".", ",");
}

function gerarItensHtml(itens = []) {
  return itens
    .map(
      (i) => `
      <tr>
        <td>${i.descricao || ""}</td>
        <td>${i.referencia || ""}</td>
        <td class="right">${formatMoney(i.proventos)}</td>
        <td class="right">${formatMoney(i.descontos)}</td>
      </tr>
    `
    )
    .join("");
}

function gerarReciboHtml(data) {
  const totalProventos = (data.itens || []).reduce(
    (a, b) => a + Number(b.proventos || 0),
    0
  );

  const totalDescontos = (data.itens || []).reduce(
    (a, b) => a + Number(b.descontos || 0),
    0
  );

  const liquido = totalProventos - totalDescontos;

  return `
  <div class="pagina">
    <div class="recibo">

      <div class="topo">
        <div class="logo-wrap">
          <div>
            <img class="logo-img" src="${logoDataUri}" />
            <div style="font-size:11px;color:#333;margin-top:2px;">
              ${data.empresa || ""}
            </div>
          </div>
        </div>

        <div class="titulo">RECIBO DE PAGAMENTO</div>
        <div style="width:88px;"></div>
      </div>

      <table class="info">
        <tr>
          <td><b>Empresa</b></td>
          <td>${data.empresa || ""}</td>
          <td><b>Referente ao Mês/Ano</b></td>
          <td>${data.mesReferencia || ""}</td>
        </tr>
        <tr>
          <td><b>Endereço</b></td>
          <td colspan="3">${data.endereco || ""}</td>
        </tr>
        <tr>
          <td><b>CNPJ</b></td>
          <td colspan="3">${data.cnpj || ""}</td>
        </tr>
      </table>

      <table class="info" style="margin-top:8px;">
        <tr>
          <td><b>Matrícula</b></td>
          <td><b>Nome do Funcionário</b></td>
          <td><b>Função</b></td>
        </tr>
        <tr>
          <td>${data.matricula || ""}</td>
          <td>${data.nome || ""}</td>
          <td>${data.funcao || ""}</td>
        </tr>
      </table>

      <table class="itens">
        <thead>
          <tr>
            <th style="width:55%;">Descrição</th>
            <th style="width:15%;">Referência</th>
            <th style="width:15%;">Proventos</th>
            <th style="width:15%;">Descontos</th>
          </tr>
        </thead>
        <tbody>
          ${gerarItensHtml(data.itens)}
        </tbody>
      </table>

      <div>
        <table class="itens">
          <thead>
            <tr>
              <th style="width:15%;">Total dos Vencimentos</th>
              <th style="width:15%;">Total dos Descontos</th>
              <th style="width:15%;">Líquido a Receber</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="right">${formatMoney(totalProventos)}</td>
              <td class="right">${formatMoney(totalDescontos)}</td>
              <td class="right bold">${formatMoney(liquido)}</td>
            </tr>
          </tbody>
        </table>

        ${
          data.mensagem
            ? `
            <div class="mensagem">
              ${data.mensagem || ""}
            </div>
          `
            : ""
        }

        <div style="display:flex;justify-content: space-between;align-items: center;flex-direction: row; width: 100%">
          <div class="assinatura-area">
            <div class="linha-assinatura"></div>
            <div class="assinatura-label">Assinatura do Funcionário</div>
          </div>

          <div class="date-box">
            <div>___/___/______</div>
            <div class="assinatura-label">Data</div>
          </div>
        </div>
      </div>

    </div>
  </div>
  `;
}

function gerarHtmlRecibos(recibos = []) {
  const recibosHtml = recibos.map(gerarReciboHtml).join("");

  return `
<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="utf-8" />
<title>Recibos</title>

<style>
html, body {
  margin: 0;
  padding: 0;
  font-family: Arial, Helvetica, sans-serif;
  color: #000;
  -webkit-print-color-adjust: exact;
}

/* container flexível */
.recibos-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* páginas */
.pagina {
  page-break-inside: avoid;
  break-inside: avoid;
}

/* recibo */
.recibo {
  width: 820px;
  margin: 0 auto;
  background: #fff;
  border: 3px solid #000;
  padding: 12px;
  box-sizing: border-box;
  position: relative;
  page-break-inside: avoid;
}

.topo {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.logo-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo-img {
  width: 88px;
  height: auto;
}

.logo-text {
  font-weight: 700;
  font-size: 34px;
  color: #2b7f2f;
}

.titulo {
  flex: 1;
  text-align: center;
  font-size: 20px;
  font-weight: 700;
}

table.info {
  width: 100%;
  border-collapse: collapse;
  margin-top: 10px;
  font-size: 12px;
}

table.info td {
  border: 1px solid #000;
  padding: 6px;
}

table.itens {
  width: 100%;
  border-collapse: collapse;
  margin-top: 10px;
  font-size: 12px;
}

table.itens th {
  border: 1px solid #000;
  padding: 6px;
  background: #eaeaea;
  text-align: left;
}

table.itens td {
  border: 1px solid #000;
  padding: 6px;
  vertical-align: middle;
}

.mensagem {
  border: 1px solid #000;
  margin-top: 8px;
  padding: 8px;
  min-height: 70px;
  font-size: 12px;
}

.assinatura-area {
  width: 75%;
}

.assinatura-label {
  text-align: center;
  font-size: 12px;
}

.linha-assinatura {
  margin-top: 30px;
  border-top: 1px solid #000;
  width: 100%;
}

.date-box {
  margin-top: 16px;
  text-align: center;
}

.right {
  text-align: right;
}

.bold {
  font-weight: 700;
}

@page {
  size: A4;
  margin: 15mm;
}
</style>
</head>

<body>
  <div class="recibos-container">
    ${recibosHtml}
  </div>
</body>
</html>
`;
}

module.exports = { gerarHtmlRecibos };
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

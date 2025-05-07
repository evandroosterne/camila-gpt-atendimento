const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const axios = require("axios");
const { OpenAI } = require("openai");

const app = express();
const PORT = process.env.PORT || 8080;

const openai = new OpenAI({
  apiKey: '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',
});

const ULTRAMSG_URL = process.env.ULTRAMSG_URL;
const TOKEN = process.env.ULTRAMSG_TOKEN;
const TELEFONE_CLINICA = process.env.TEL_CLINICA;
const TELEFONE_EVANDRO = process.env.TEL_EVANDRO;

const estadoPacientes = {};

app.use(bodyParser.json());

app.post("/webhook", async (req, res) => {
  const msg = req.body.data?.body?.trim();
  const numero = req.body.data?.from;
  const senderName = req.body.data?.senderName || "amigo(a)";

  if (!msg || !numero) return res.sendStatus(400);

  if (!estadoPacientes[numero]) {
    estadoPacientes[numero] = {
      nome: null,
      nomeConfirmado: false,
      aguardandoNome: false,
      tentativaNome: 0,
      alertaEnviado: false,
    };
  }

  const paciente = estadoPacientes[numero];
  const msgLower = msg.toLowerCase();

  if (!paciente.nomeConfirmado) {
    const pareceNome = /^[a-zA-Zà-úÀ-ÚçÇ ]{4,}$/.test(msg);
    const desviou = msgLower.includes("implante") || msgLower.includes("clareamento") || msgLower.includes("quero");

    if (!paciente.aguardandoNome) {
      paciente.aguardandoNome = true;
      paciente.tentativaNome = 1;
      await axios.post(`${ULTRAMSG_URL}messages/chat`, {
        token: TOKEN,
        to: numero,
        body: `👋 Oi! Só pra gente continuar direitinho, qual é o seu nome completo? 😊`,
      });
      return res.sendStatus(200);
    }

    if (pareceNome) {
      paciente.nome = msg;
      paciente.nomeConfirmado = true;
      paciente.aguardandoNome = false;
    } else {
      paciente.tentativaNome += 1;
      if (paciente.tentativaNome <= 2) {
        await axios.post(`${ULTRAMSG_URL}messages/chat`, {
          token: TOKEN,
          to: numero,
          body: `😊 Claro, ${senderName}! Antes de te responder direitinho, me diz só seu nome completo?`,
        });
      } else {
        await axios.post(`${ULTRAMSG_URL}messages/chat`, {
          token: TOKEN,
          to: numero,
          body: `🙏 Só consigo te ajudar melhor se eu souber seu nome completo, ${senderName}. Pode me dizer?`,
        });
      }
      return res.sendStatus(200);
    }
  }

  const mencionaDor = msgLower.includes("dor") || msgLower.includes("sangramento") || msgLower.includes("urgente");

  if (mencionaDor && !paciente.alertaEnviado) {
    paciente.alertaEnviado = true;
    const alerta = `🚨 Alerta de urgência!
Nome: ${paciente.nome}
Telefone: ${numero}
Mensagem: "${msg}"`;
    await axios.post(`${ULTRAMSG_URL}messages/chat`, { token: TOKEN, to: TELEFONE_CLINICA, body: alerta });
    await axios.post(`${ULTRAMSG_URL}messages/chat`, { token: TOKEN, to: TELEFONE_EVANDRO, body: alerta });
    await axios.post(`${ULTRAMSG_URL}messages/chat`, {
      token: TOKEN,
      to: numero,
      body: `💡 Obrigado, ${paciente.nome}! Já avisei a equipe. Vamos cuidar de você rapidinho!`,
    });
    return res.sendStatus(200);
  }

  try {
    const respostaGPT = await openai.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "Seja uma assistente da Onne Odontologia. Use linguagem curta, leve e convincente. Use sempre o nome do paciente.",
        },
        { role: "user", content: msg },
      ],
      model: "gpt-4",
    });

    let resposta = respostaGPT.choices[0].message.content;
    resposta = `🦷 ${paciente.nome}, ${resposta}`;

    if (
      msgLower.includes("quero agendar") ||
      msgLower.includes("marcar consulta") ||
      msgLower.includes("falar com atendente")
    ) {
      resposta += `

📞 Vou te passar pra um atendente agora, tudo bem?`;
      await axios.post(`${ULTRAMSG_URL}messages/chat`, {
        token: TOKEN,
        to: TELEFONE_CLINICA,
        body: `📲 ${paciente.nome} (${numero}) quer atendimento humano.
Mensagem: "${msg}"`,
      });
    }

    await axios.post(`${ULTRAMSG_URL}messages/chat`, {
      token: TOKEN,
      to: numero,
      body: resposta,
    });

    const csv = `${new Date().toISOString()},${paciente.nome},${numero},"${msg}","${resposta.replace(/"/g, "'")}"
`;
    fs.appendFileSync("respostas_gpt.csv", csv);

    res.sendStatus(200);
  } catch (erro) {
    console.error("❌ Erro:", erro.response?.data || erro.message);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Camila GPT - Railway deploy rodando na porta ${PORT}`);
});
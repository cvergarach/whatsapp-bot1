const express = require('express');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// ============ CONFIGURACIÓN ============
const GEMINI_API_KEY = 'AIzaSyBOr9OM1pnisKdfcKijgtND5xGw2fwxK-U';
const PORT = process.env.PORT || 3000;
const AGENTS_FILE = path.join('/tmp', 'agents.json');

// ============ ESTADO DE WHATSAPP ============
let sock;
let qrCode = null;
let isConnected = false;
let connectionAttempts = 0;
const MAX_ATTEMPTS = 3;

// Crear directorio temporal para auth si no existe
const authDir = path.join('/tmp', 'auth_info');
if (!fs.existsSync(authDir)) {
  fs.mkdirSync(authDir, { recursive: true });
}

// ============ GESTIÓN DE AGENTES ============
function getAgents() {
  if (!fs.existsSync(AGENTS_FILE)) {
    const defaultAgent = [{
      id: "default",
      name: "Asistente General",
      systemPrompt: "Eres un asistente útil y amable.",
      keywords: ["*"],
      isDefault: true
    }];
    saveAgents(defaultAgent);
    return defaultAgent;
  }
  const data = fs.readFileSync(AGENTS_FILE, 'utf8');
  return JSON.parse(data);
}

function saveAgents(agents) {
  fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2));
}

function findAgentForMessage(text) {
  const agents = getAgents();
  const matchedAgent = agents.find(agent =>
    agent.keywords && agent.keywords.some(keyword =>
      keyword !== '*' && text.toLowerCase().includes(keyword.toLowerCase())
    )
  );

  if (matchedAgent) return matchedAgent;
  return agents.find(agent => agent.isDefault) || agents[0];
}

// ============ FUNCIÓN PARA LLAMAR A GEMINI ============
async function askGemini(question, systemPrompt = '') {
  try {
    // Modelos disponibles: gemini-1.5-flash, gemini-1.5-pro, gemini-2.0-flash-exp
    const MODEL_ID = 'gemini-2.5-flash';
    
    const prompt = systemPrompt ? `${systemPrompt}\n\nUsuario: ${question}` : question;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Error API Gemini:', JSON.stringify(data, null, 2));
      return `Error del sistema: ${data.error?.message || 'Error desconocido de la API'}`;
    }

    if (data.candidates && data.candidates[0]) {
      return data.candidates[0].content.parts[0].text;
    }

    console.error('❌ Respuesta inesperada de Gemini:', JSON.stringify(data, null, 2));
    return 'Lo siento, no pude procesar tu mensaje.';
  } catch (error) {
    console.error('❌ Error llamando a Gemini:', error);
    return 'Hubo un error al procesar tu mensaje. Intenta de nuevo.';
  }
}

// ============ INICIAR WHATSAPP ============
async function connectToWhatsApp() {
  try {
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: ['FunnelBot AI', 'Chrome', '1.0.0'],
      markOnlineOnConnect: true,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCode = qr;
        connectionAttempts = 0;
        console.log('📱 Nuevo QR generado');
        console.log('QR disponible en: /qr');
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('⚠️  Conexión cerrada. Razón:', lastDisconnect?.error?.output?.statusCode);

        isConnected = false;

        if (shouldReconnect && connectionAttempts < MAX_ATTEMPTS) {
          connectionAttempts++;
          console.log(`🔄 Reintentando conexión (${connectionAttempts}/${MAX_ATTEMPTS})...`);
          setTimeout(() => connectToWhatsApp(), 5000);
        } else if (connectionAttempts >= MAX_ATTEMPTS) {
          console.log('❌ Máximo de intentos alcanzado. Escanea el QR nuevamente.');
          qrCode = null;
          connectionAttempts = 0;
        }
      } else if (connection === 'open') {
        console.log('✅ ¡Conectado a WhatsApp exitosamente!');
        isConnected = true;
        qrCode = null;
        connectionAttempts = 0;
      }
    });

    // ============ RECIBIR MENSAJES ============
    sock.ev.on('messages.upsert', async (m) => {
      try {
        const msg = m.messages[0];

        if (!msg.message) return;
        if (msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = msg.message.conversation ||
          msg.message.extendedTextMessage?.text || '';

        if (!text) return;

        console.log(`📩 Mensaje de ${from}: ${text}`);

        await sock.sendPresenceUpdate('composing', from);

        const agent = findAgentForMessage(text);
        console.log(`🤖 Usando agente: ${agent ? agent.name : 'Default'}`);

        const response = await askGemini(text, agent ? agent.systemPrompt : '');

        await sock.sendMessage(from, { text: response });

        console.log(`✅ Respuesta enviada`);
      } catch (error) {
        console.error('❌ Error procesando mensaje:', error);
      }
    });

  } catch (error) {
    console.error('❌ Error al conectar:', error);
    if (connectionAttempts < MAX_ATTEMPTS) {
      connectionAttempts++;
      setTimeout(() => connectToWhatsApp(), 5000);
    }
  }
}

// ============ RUTAS DE LA API ============

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    connected: isConnected,
    message: isConnected 
      ? '✅ Bot conectado a WhatsApp' 
      : '⏳ Esperando conexión. Ve a /qr para obtener el código',
    qrAvailable: qrCode !== null,
    endpoints: {
      qr: '/qr - Obtener código QR',
      status: '/status - Estado de conexión',
      restart: '/restart - Reiniciar conexión',
      agents: '/api/agents - Gestionar agentes'
    }
  });
});

app.get('/api/agents', (req, res) => {
  res.json(getAgents());
});

app.post('/api/agents', (req, res) => {
  const agents = getAgents();
  const newAgent = { ...req.body, id: Date.now().toString() };

  if (newAgent.isDefault) {
    agents.forEach(a => a.isDefault = false);
  }

  agents.push(newAgent);
  saveAgents(agents);
  res.json(newAgent);
});

app.put('/api/agents/:id', (req, res) => {
  const agents = getAgents();
  const index = agents.findIndex(a => a.id === req.params.id);

  if (index !== -1) {
    const updatedAgent = { ...agents[index], ...req.body };

    if (updatedAgent.isDefault) {
      agents.forEach(a => a.isDefault = false);
    }

    agents[index] = updatedAgent;
    saveAgents(agents);
    res.json(updatedAgent);
  } else {
    res.status(404).json({ error: 'Agente no encontrado' });
  }
});

app.delete('/api/agents/:id', (req, res) => {
  let agents = getAgents();
  agents = agents.filter(a => a.id !== req.params.id);
  saveAgents(agents);
  res.json({ success: true });
});

app.get('/qr', (req, res) => {
  if (qrCode) {
    res.json({
      success: true,
      qr: qrCode,
      message: '📱 Escanea este código con WhatsApp',
      instructions: 'Copia el texto QR y usa https://www.qrcode-monkey.com/ para visualizarlo'
    });
  } else if (isConnected) {
    res.json({
      success: false,
      message: '✅ Ya estás conectado a WhatsApp. No necesitas escanear el QR.'
    });
  } else {
    res.json({
      success: false,
      message: '⏳ QR no disponible aún. Espera 10-20 segundos y recarga esta página.'
    });
  }
});

app.get('/status', (req, res) => {
  res.json({
    connected: isConnected,
    hasQR: qrCode !== null,
    connectionAttempts,
    timestamp: new Date().toISOString(),
    message: isConnected ? '✅ Conectado' : '❌ Desconectado'
  });
});

app.get('/restart', (req, res) => {
  connectionAttempts = 0;
  qrCode = null;
  isConnected = false;

  if (sock) {
    sock.end();
  }

  setTimeout(() => {
    connectToWhatsApp();
  }, 2000);

  res.json({
    success: true,
    message: '🔄 Reiniciando conexión. Espera 10 segundos y ve a /qr'
  });
});

// ============ INICIAR SERVIDOR ============
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`🌐 Endpoints disponibles:`);
  console.log(`   - /qr (Obtener código QR)`);
  console.log(`   - /status (Ver estado)`);
  console.log(`   - /restart (Reiniciar)`);
  console.log(`   - /api/agents (Gestionar agentes)`);
  console.log(`📱 Iniciando conexión a WhatsApp...`);
  connectToWhatsApp();
});

process.on('uncaughtException', (err) => {
  console.error('❌ Error no capturado:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('❌ Promesa rechazada:', err);
});
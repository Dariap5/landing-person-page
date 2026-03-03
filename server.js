const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
require("dotenv").config();

const app = express();

// 1) CORS: разрешаем только твой сайт
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN,
  methods: ["POST", "OPTIONS"],
}));

// 2) Парсим JSON
app.use(express.json({ limit: "200kb" }));

// 3) База
const db = new Database("leads.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    name TEXT,
    contact TEXT NOT NULL,
    message TEXT,
    page TEXT,
    user_agent TEXT,
    ip TEXT
  );
`);

const insertLead = db.prepare(`
  INSERT INTO leads (created_at, name, contact, message, page, user_agent, ip)
  VALUES (@created_at, @name, @contact, @message, @page, @user_agent, @ip)
`);

async function sendToTelegram(text) {
  const token = process.env.BOT_TOKEN;
  const chatId = process.env.CHAT_ID;

  if (!token || !chatId) return;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true
    })
  });

  const data = await res.json();
  if (!data.ok) {
    console.error("Telegram error:", data);
  }
}

// Healthcheck
app.get("/health", (req, res) => res.json({ ok: true }));

// Главный эндпоинт
app.post("/lead", async (req, res) => {
  try {
    const { name = "", contact = "", message = "", page = "", user_agent = "" } = req.body || {};

    if (!contact.trim()) {
      return res.status(400).json({ ok: false, error: "contact is required" });
    }

    const lead = {
      created_at: new Date().toISOString(),
      name: String(name).slice(0, 200),
      contact: String(contact).slice(0, 200),
      message: String(message).slice(0, 4000),
      page: String(page).slice(0, 500),
      user_agent: String(user_agent).slice(0, 500),
      ip: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || ""
    };

    const info = insertLead.run(lead);

    const tgText =
      `🆕 <b>Новая заявка с сайта</b>\n\n` +
      `👤 <b>Имя:</b> ${escapeHtml(lead.name || "—")}\n` +
      `📩 <b>Контакт:</b> ${escapeHtml(lead.contact)}\n` +
      `📝 <b>Сообщение:</b> ${escapeHtml(lead.message || "—")}\n\n` +
      `🔗 <b>Страница:</b> ${escapeHtml(lead.page || "—")}\n` +
      `🌍 <b>IP:</b> ${escapeHtml(lead.ip || "—")}`;

    // не блокируем ответ — отправляем в телегу асинхронно
    sendToTelegram(tgText).catch(console.error);

    return res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on :${port}`));

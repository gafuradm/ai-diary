import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { db } from "./db.js";
import "dotenv/config";
import { analyzeText, generateDailyComment } from "./deepseek.js";
import axios from "axios";
import { judgeAction } from "./deepseek.js";
import { detectSabotage } from "./deepseek.js";

const app = express();
app.use(cors());
app.use(express.json());

// ==========================
// DeepSeek: прогноз на будущее
// ==========================
async function generateForecast(text) {
  try {
    const response = await axios.post(
      "https://api.deepseek.com/v1/chat/completions",
      {
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: `
You are a future prediction AI. 
Analyze the diary text and return JSON ONLY in this format:
{
  "overallSentiment": "positive" | "neutral" | "negative",
  "avgEmotions": {
    "joy": number,
    "sadness": number,
    "anger": number,
    "fear": number
  },
  "advice": "string"
}
No extra text, no markdown.
            `
          },
          { role: "user", content: text }
        ],
        temperature: 0.8
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    let content = response.data.choices[0].message.content;
    content = content.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(content);
  } catch (err) {
    console.error("DeepSeek forecast error:", err.response?.data || err.message);
    throw new Error("Не удалось сгенерировать прогноз от AI");
  }
}

// ==========================
// Создание записи дневника
// ==========================
app.post("/api/entries", async (req, res) => {
  try {
    const { content } = req.body;
    const analysis = await analyzeText(content);

    const entry = {
      id: uuidv4(),
      content,
      sentiment_score: analysis.score,
      sentiment_label: analysis.label,
      emotions: JSON.stringify(analysis.emotions),
      created_at: new Date().toISOString()
    };

    db.prepare(`
      INSERT INTO entries (id, content, sentiment_score, sentiment_label, emotions, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      entry.id,
      entry.content,
      entry.sentiment_score,
      entry.sentiment_label,
      entry.emotions,
      entry.created_at
    );

    res.json(entry);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI analysis failed" });
  }
});

// ==========================
// Генерация комментария AI
// ==========================
app.post("/api/comment", async (req, res) => {
  try {
    const { content } = req.body;
    const aiComment = await generateDailyComment(content);
    res.json({ comment: aiComment });
  } catch (err) {
    console.error(err);
    res.status(500).json({ comment: "Комментарий AI недоступен" });
  }
});

// ==========================
// Прогноз по всей истории дневника
// ==========================
app.post("/api/future-full", async (req, res) => {
  try {
    const rows = db.prepare(`SELECT * FROM entries ORDER BY created_at ASC`).all();

    if (!rows.length) return res.json({ forecast: "Нет записей для анализа истории" });

    const fullText = rows.map(e => `${e.created_at}: ${e.content}`).join("\n");

    // Вызов DeepSeek для прогноза всей истории
    const aiForecast = await generateDailyComment(`
Предскажи пользователю будущее на основе всей истории его дневника:
${fullText}

Верни текстовый прогноз через год, включая:
- Общее состояние
- Эмоциональный профиль
- Совет
- Краткие комментарии по каждому дню
Только текст, без JSON и разметки
`);

    res.json({ forecast: aiForecast });
  } catch (err) {
    console.error(err);
    res.status(500).json({ forecast: "Не удалось сгенерировать прогноз от AI" });
  }
});

// ==========================
// Получение всех записей
// ==========================
app.get("/api/entries", (req, res) => {
  const rows = db.prepare(`SELECT * FROM entries ORDER BY created_at DESC`).all();
  res.json(rows);
});

// ==========================
// Прогноз по тексту пользователя
app.post("/api/forecast", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Нет текста для прогноза" });
    }

    // Вызов DeepSeek для генерации прогноза
    const forecastText = await generateDailyComment(`
Предскажи пользователю, что произойдет через год, если он продолжит жить как описано ниже.
Текст пользователя: ${text}

Верни строго текстовый прогноз, без JSON, без разметки:
- Общее состояние
- Эмоциональный профиль
- Совет
`);

    res.json({ forecast: forecastText }); // возвращаем как строку
  } catch (err) {
    console.error("FORECAST ERROR:", err);
    res.status(500).json({ error: "Не удалось сделать прогноз" });
  }
});

// ==========================
// Детальный прогноз по дням
// ==========================
app.post("/api/future-detailed", async (req, res) => {
  try {
    const rows = db.prepare(`SELECT * FROM entries ORDER BY created_at ASC`).all();
    if (!rows.length) return res.json({ forecast: "Нет записей для анализа истории" });

    const detailedResults = [];

    for (const e of rows) {
      const analysis = await analyzeText(e.content);
      const parsedEmotions = typeof analysis.emotions === "string"
        ? JSON.parse(analysis.emotions)
        : analysis.emotions;

      const comment = await generateDailyComment(e.content);

      detailedResults.push({
        date: e.created_at,
        content: e.content,
        sentiment: analysis.label,
        emotions: parsedEmotions,
        comment
      });
    }

    // Средние эмоции
    const emotionSums = { joy: 0, sadness: 0, anger: 0, fear: 0 };
    detailedResults.forEach(r => {
      for (const k in emotionSums) emotionSums[k] += r.emotions[k] || 0;
    });
    const n = detailedResults.length;
    const avgEmotions = {};
    for (const k in emotionSums) avgEmotions[k] = +(emotionSums[k]/n).toFixed(2);

    // Общая тональность
    const sentimentCounts = { positive: 0, negative: 0, neutral: 0 };
    detailedResults.forEach(r => sentimentCounts[r.sentiment]++);
    const overallSentiment = sentimentCounts.positive >= sentimentCounts.negative ? "positive" : "negative";

    // Сбор итогового прогноза
    const forecast = {
      overallSentiment,
      avgEmotions,
      advice: "Смотрите рекомендации AI в комментариях к каждому дню.",
      detailedResults
    };

    res.json(forecast);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Не удалось сгенерировать детальный прогноз" });
  }
});

// ==========================
// AI-СУДЬЯ
// ==========================
// ==========================
// AI-Судья: оценка всех записей
// ==========================
app.get("/api/judge-all", async (req, res) => {
  try {
    const rows = db.prepare(`SELECT * FROM entries ORDER BY created_at ASC`).all();
    if (!rows.length) return res.json({ results: [] });

    const results = await Promise.all(
      rows.map(async (entry) => {
        const j = await judgeAction(entry.content);   // <-- ВАЖНО!
        return {
          id: entry.id,
          date: entry.created_at,
          content: entry.content,
          benefit: j.benefit,
          risk: j.risk,
          morality: j.morality,
          consequences: j.consequences,
          verdict: j.verdict
        };
      })
    );

    res.json({ results });
  } catch (err) {
    console.error("AI-Judge error:", err);
    res.status(500).json({ error: "AI judge failed" });
  }
});

app.get("/api/sabotage", async (req, res) => {
  try {
    const rows = db.prepare(`SELECT * FROM entries ORDER BY created_at ASC`).all();
    if (!rows.length) return res.json({ results: [] });

    const results = await Promise.all(
      rows.map(async (entry) => {
        const s = await detectSabotage(entry.content);
        return {
          id: entry.id,
          date: entry.created_at,
          content: entry.content,
          procrastination: s.procrastination,
          self_deception: s.self_deception,
          loops: s.loops,
          summary: s.summary
        };
      })
    );
    
    res.json({ results });    
  } catch (err) {
    console.error("SABOTAGE ERROR:", err);
    res.status(500).json({ error: "Detectors sabotажа не работает" });
  }
});

const PORT = process.env.PORT || 4000;

app.post("/api/comments-batch", async (req, res) => {
  try {
    const { entries } = req.body;

    const results = [];

    for (const e of entries) {
      try {
        const comment = await generateDailyComment(e.content);
        results.push({ id: e.id, comment });
      } catch {
        results.push({ id: e.id, comment: "AI unavailable" });
      }
    }

    res.json({ results });
  } catch (err) {
    console.error("BATCH COMMENT ERROR:", err);
    res.status(500).json({ error: "Batch failed" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("✅ Server running on port " + PORT);
});

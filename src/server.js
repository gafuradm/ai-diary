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
// DeepSeek: future forecast
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
    throw new Error("Failed to generate AI forecast");
  }
}

// ==========================
// Create diary entry
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
// Generate AI comment
// ==========================
app.post("/api/comment", async (req, res) => {
  try {
    const { content } = req.body;
    const aiComment = await generateDailyComment(content);
    res.json({ comment: aiComment });
  } catch (err) {
    console.error(err);
    res.status(500).json({ comment: "AI comment unavailable" });
  }
});

// ==========================
// Forecast based on entire diary history
// ==========================
app.post("/api/future-full", async (req, res) => {
  try {
    const rows = db.prepare(`SELECT * FROM entries ORDER BY created_at ASC`).all();

    if (!rows.length) return res.json({ forecast: "No entries available for historical analysis" });

    const fullText = rows.map(e => `${e.created_at}: ${e.content}`).join("\n");

    // Call DeepSeek for full history forecast
    const aiForecast = await generateDailyComment(`
Predict the user's future based on their entire diary history:
${fullText}

Return a textual forecast for one year from now, including:
- Overall condition
- Emotional profile
- Advice
- Brief comments for each day
Text only, no JSON or markup
`);

    res.json({ forecast: aiForecast });
  } catch (err) {
    console.error(err);
    res.status(500).json({ forecast: "Failed to generate AI forecast" });
  }
});

// ==========================
// Get all entries
// ==========================
app.get("/api/entries", (req, res) => {
  const rows = db.prepare(`SELECT * FROM entries ORDER BY created_at DESC`).all();
  res.json(rows);
});

// ==========================
// Forecast based on user text
app.post("/api/forecast", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "No text provided for forecast" });
    }

    // Call DeepSeek to generate forecast
    const forecastText = await generateDailyComment(`
Predict what will happen to the user in one year if they continue living as described below.
User text: ${text}

Return strictly textual forecast, no JSON, no markup:
- Overall condition
- Emotional profile
- Advice
`);

    res.json({ forecast: forecastText }); // return as string
  } catch (err) {
    console.error("FORECAST ERROR:", err);
    res.status(500).json({ error: "Failed to generate forecast" });
  }
});

// ==========================
// Detailed daily forecast
// ==========================
app.post("/api/future-detailed", async (req, res) => {
  try {
    const rows = db.prepare(`SELECT * FROM entries ORDER BY created_at ASC`).all();
    if (!rows.length) return res.json({ forecast: "No entries available for historical analysis" });

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

    // Average emotions
    const emotionSums = { joy: 0, sadness: 0, anger: 0, fear: 0 };
    detailedResults.forEach(r => {
      for (const k in emotionSums) emotionSums[k] += r.emotions[k] || 0;
    });
    const n = detailedResults.length;
    const avgEmotions = {};
    for (const k in emotionSums) avgEmotions[k] = +(emotionSums[k]/n).toFixed(2);

    // Overall sentiment
    const sentimentCounts = { positive: 0, negative: 0, neutral: 0 };
    detailedResults.forEach(r => sentimentCounts[r.sentiment]++);
    const overallSentiment = sentimentCounts.positive >= sentimentCounts.negative ? "positive" : "negative";

    // Compile final forecast
    const forecast = {
      overallSentiment,
      avgEmotions,
      advice: "See AI recommendations in comments for each day.",
      detailedResults
    };

    res.json(forecast);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate detailed forecast" });
  }
});

// ==========================
// AI-JUDGE
// ==========================
// ==========================
// AI-Judge: evaluate all entries
// ==========================
app.get("/api/judge-all", async (req, res) => {
  try {
    const rows = db.prepare(`SELECT * FROM entries ORDER BY created_at ASC`).all();
    if (!rows.length) return res.json({ results: [] });

    const results = await Promise.all(
      rows.map(async (entry) => {
        const j = await judgeAction(entry.content);   // <-- IMPORTANT!
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
    res.status(500).json({ error: "Sabotage detector is not working" });
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
    res.status(500).json({ error: "Batch processing failed" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("✅ Server running on port " + PORT);
});
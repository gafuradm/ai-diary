import axios from "axios";
import "dotenv/config";

export async function analyzeText(text) {
  try {
    const response = await axios.post(
      "https://api.deepseek.com/v1/chat/completions",
      {
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: "You are a sentiment analysis AI. Return JSON only, no markdown, no extra text."
          },
          {
            role: "user",
            content: `
Analyze this diary text.
Return JSON exactly in this format:
{
  "score": number from -1 to 1,
  "label": "positive" | "neutral" | "negative",
  "emotions": {
    "joy": number,
    "sadness": number,
    "anger": number,
    "fear": number
  }
}

Text:
${text}
            `
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    // Получаем ответ
    let content = response.data.choices[0].message.content;

    // Убираем возможные ```json или ``` вокруг
    content = content.replace(/```json/g, "").replace(/```/g, "").trim();

    // Парсим JSON
    return JSON.parse(content);
  } catch (err) {
    console.error("DeepSeek error:", err.response?.data || err.message);
    throw new Error("AI analysis failed");
  }
}

export async function generateDailyComment(text) {
  const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        {
          role: "system",
          content: "Ты — умный дневниковый психолог. Дай тёплый, подробный комментарий к записи пользователя. Без морализаторства."
        },
        {
          role: "user",
          content: text
        }
      ],
      temperature: 0.8
    })
  });

  const data = await response.json();
  return data.choices[0].message.content;
}

export async function generateForecast(text) {
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
}

export async function judgeAction(text) {
  try {
    const response = await axios.post(
      "https://api.deepseek.com/v1/chat/completions",
      {
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: `
Return STRICT JSON ONLY.
No explanations. No comments. No text.

The JSON MUST be exactly in this format:
{
  "benefit": number,
  "risk": number,
  "morality": number,
  "consequences": "string",
  "verdict": "string"
}
            `
          },
          { role: "user", content: text }
        ],
        temperature: 0.2
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    let raw = response.data.choices[0].message.content.trim();

    // Удаляем возможные ```json блоки
    raw = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

    // Находим первую и последнюю фигурную скобку
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}") + 1;
    const clean = raw.slice(start, end);

    return JSON.parse(clean);

  } catch (err) {
    console.error("Judge error:", err.response?.data || err.message);
    throw new Error("AI judge failed");
  }
}

export async function detectSabotage(text) {
  try {
    const response = await axios.post(
      "https://api.deepseek.com/v1/chat/completions",
      {
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: `
Ты — AI-Детектор Саботажа.
Оцени текст пользователя по трём шкалам:

1. "procrastination": число 0-10 — насколько запись показывает избегание, откладывание, прокрастинацию.
2. "self_deception": число 0-10 — насколько пользователь врёт себе, рационализирует, придумывает оправдания.
3. "loops": число 0-10 — насколько запись показывает повторяющийся жизненный тупик или замкнутый круг.

Верни СТРОГО JSON:
{
  "procrastination": number,
  "self_deception": number,
  "loops": number,
  "summary": "короткий вывод"
}

Только JSON. Без лишнего текста.
`
          },
          {
            role: "user",
            content: text
          }
        ],
        temperature: 0.7
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    let raw = response.data.choices[0].message.content;
    raw = raw.replace(/```json/g, "").replace(/```/g, "").trim();

    return JSON.parse(raw);
  } catch (err) {
    console.error("Sabotage detector error:", err.response?.data || err.message);
    throw new Error("Sabotage detector failed");
  }
}

'use strict';

const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

const app = express();
const PORT = Number(process.env.PORT) || 10000;
const apiKey = String(process.env.GEMINI_API_KEY || '').trim();

app.disable('x-powered-by');
// Render runs behind a reverse proxy; trust its first proxy hop for rate limiting.
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '20kb' }));

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'وصلت إلى حد الرسائل المؤقت. انتظر دقيقة ثم حاول مجددًا.' }
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'SAMH AI' }));

app.post('/api/ai/chat', aiLimiter, async (req, res) => {
  if (!apiKey) return res.status(503).json({ error: 'خدمة الذكاء الاصطناعي غير مهيأة.' });

  const incoming = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
  const messages = incoming.slice(-12).map(item => ({
    role: item && item.role === 'model' ? 'model' : 'user',
    text: String(item && item.text || '').trim().slice(0, 4000)
  })).filter(item => item.text);

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'اكتب رسالتك أولاً.' });
  }

  const contents = messages.map(item => ({ role: item.role, parts: [{ text: item.text }] }));
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: 'أنت SAMH AI، مساعد سَمْح الذكي. أجب بالعربية الواضحة وبأسلوب ودود ومختصر، وساعد في التقنية والبرمجة واستخدام التطبيق. لا تدّع تنفيذ إجراءات على جهاز المستخدم.' }] },
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
      }),
      signal: AbortSignal.timeout(55000)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('[SAMH AI] Gemini error:', response.status, data && data.error && data.error.message || JSON.stringify(data).slice(0, 1000));
      if (response.status === 429) return res.status(429).json({ error: 'وصلت خدمة الذكاء الاصطناعي إلى حد الاستخدام مؤقتًا.' });
      if (response.status === 401 || response.status === 403) return res.status(502).json({ error: 'تعذر التحقق من إعدادات خدمة الذكاء الاصطناعي.' });
      return res.status(502).json({ error: 'تعذر على Gemini معالجة الطلب. حاول لاحقًا.' });
    }

    const answer = (data.candidates || [])
      .flatMap(candidate => candidate.content && candidate.content.parts || [])
      .map(part => part.text || '')
      .join('')
      .trim();

    if (!answer) return res.status(502).json({ error: 'وصل رد فارغ من Gemini.' });
    return res.json({ success: true, answer });
  } catch (error) {
    console.error('[SAMH AI] request failed:', error && error.message);
    const timeout = error && error.name === 'TimeoutError';
    return res.status(timeout ? 504 : 502).json({
      error: timeout ? 'انتهت مهلة الرد. حاول مجددًا.' : 'تعذر الاتصال بخدمة الذكاء الاصطناعي.'
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SAMH AI service listening on ${PORT}`);
});

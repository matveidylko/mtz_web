/**
 * Минимальный Cloudflare Worker-прокси для чата сайта МТЗ 82.1.
 * Храните OPENROUTER_API_KEY только в настройках Worker Secrets, никогда не в index.html.
 * Обязательная переменная окружения: ALLOWED_ORIGIN, например https://example.pages.dev
 */
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

function json(data, status, cors = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...cors } });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowedOrigin = String(env.ALLOWED_ORIGIN || '').replace(/\/$/, '');
    const cors = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin'
    };

    if (!allowedOrigin) return json({ error: 'Set ALLOWED_ORIGIN in Worker variables.' }, 500);
    if (origin !== allowedOrigin) return json({ error: 'Origin is not allowed.' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, cors);
    if (!env.OPENROUTER_API_KEY) return json({ error: 'OpenRouter API key is not configured on the server.' }, 503, cors);

    try {
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).length > 18000) return json({ error: 'Request is too large.' }, 413, cors);
      const input = JSON.parse(rawBody);
      if (!Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > 14) {
        return json({ error: 'Invalid chat messages.' }, 400, cors);
      }

      const messages = input.messages.map((message) => {
        const role = ['system', 'user', 'assistant'].includes(message?.role) ? message.role : null;
        const content = typeof message?.content === 'string' ? message.content.slice(0, 12000) : '';
        if (!role || !content) throw new Error('A message has an invalid role or content.');
        return { role, content };
      });

      // Модель задаётся на сервере, чтобы публичный клиент не мог выбрать платную модель.
      const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': allowedOrigin,
          'X-Title': 'Интерактивная VR-модель МТЗ 82.1'
        },
        body: JSON.stringify({
          model: 'openrouter/free',
          messages,
          temperature: 0.35,
          max_tokens: 520
        })
      });

      const responseText = await upstream.text();
      return new Response(responseText, {
        status: upstream.status,
        headers: { ...JSON_HEADERS, ...cors }
      });
    } catch (error) {
      return json({ error: error?.message || 'Proxy request failed.' }, 400, cors);
    }
  }
};

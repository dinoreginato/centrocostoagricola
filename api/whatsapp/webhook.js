const readJson = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const sendWhatsappText = async ({ to, text }) => {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return { ok: false, error: 'missing_env' };

  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text }
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) return { ok: false, error: data };
  return { ok: true, data };
};

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');

      if (!mode || !token || !challenge) {
        res.statusCode = 400;
        res.end('missing_params');
        return;
      }

      const expected = process.env.WHATSAPP_VERIFY_TOKEN;
      if (mode === 'subscribe' && expected && token === expected) {
        res.statusCode = 200;
        res.end(String(challenge));
        return;
      }

      res.statusCode = 403;
      res.end('forbidden');
      return;
    }

    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Método no permitido' }));
      return;
    }

    const payload = await readJson(req);
    const entry = payload?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    const from = String(message.from || '').trim();
    const text = String(message?.text?.body || '').trim();

    if (from && text) {
      const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
      const proto = (req.headers['x-forwarded-proto'] || 'https').toString();
      const base = host ? `${proto}://${host}` : '';
      const link = base ? `${base}/asistente?q=${encodeURIComponent(text)}` : '/asistente';
      const reply =
        `Recibido: "${text}".\n` +
        `Para generar el reporte y descargar PDF/Excel, abre:\n${link}\n` +
        `Si quieres que el reporte llegue como archivo por WhatsApp, se habilita en la siguiente fase.`;

      await sendWhatsappText({ to: from, text: reply });
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Error interno', detail: String(e?.message || e) }));
  }
}


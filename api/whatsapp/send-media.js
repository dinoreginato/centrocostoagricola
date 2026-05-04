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

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Método no permitido' }));
      return;
    }

    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!token || !phoneNumberId) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Faltan variables WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID' }));
      return;
    }

    const body = await readJson(req);
    const to = String(body?.to || '').trim();
    const filename = String(body?.filename || '').trim();
    const mime = String(body?.mime || '').trim();
    const base64 = String(body?.dataBase64 || '').trim();
    const caption = String(body?.caption || '').trim();

    if (!to || !filename || !mime || !base64) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Faltan campos: to, filename, mime, dataBase64' }));
      return;
    }

    const buffer = Buffer.from(base64, 'base64');
    if (!buffer || buffer.length === 0) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Archivo vacío' }));
      return;
    }

    const mediaUrl = `https://graph.facebook.com/v19.0/${phoneNumberId}/media`;
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', new Blob([buffer], { type: mime }), filename);

    const mediaResp = await fetch(mediaUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form
    });

    const mediaData = await mediaResp.json().catch(() => ({}));
    const mediaId = String(mediaData?.id || '');

    if (!mediaResp.ok || !mediaId) {
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'No se pudo subir media a WhatsApp', detail: mediaData }));
      return;
    }

    const msgUrl = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'document',
      document: {
        id: mediaId,
        filename
      }
    };

    if (caption) (payload.document).caption = caption;

    const msgResp = await fetch(msgUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const msgData = await msgResp.json().catch(() => ({}));
    if (!msgResp.ok) {
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'No se pudo enviar documento', detail: msgData }));
      return;
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: true, data: msgData }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Error interno', detail: String(e?.message || e) }));
  }
}


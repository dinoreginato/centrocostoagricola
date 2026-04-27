type JsonResponse<T> = {
  data?: T;
};

export type AgrometItem = Record<string, unknown>;

async function getJsonOrThrow<T>(resp: Response): Promise<T> {
  if (!resp.ok) throw new Error('No se pudo obtener Agrometeorología');
  const ct = resp.headers.get('content-type') || '';
  if (!ct.includes('application/json')) throw new Error('Respuesta no válida desde Agrometeorología');
  return resp.json() as Promise<T>;
}

export async function fetchAgrometItemsResumen() {
  const resp = await fetch('/api/agromet/items-resumen.js', { headers: { accept: 'application/json' } });
  const json = await getJsonOrThrow<JsonResponse<AgrometItem[]>>(resp);
  return json?.data || [];
}

export async function fetchAgrometPpDay(params: { station: string; from: string; to: string }) {
  const url = `/api/agromet/pp-day.js?station=${encodeURIComponent(params.station)}&from=${params.from}&to=${params.to}`;
  const resp = await fetch(url, { headers: { accept: 'application/json' } });
  const json = await getJsonOrThrow<JsonResponse<AgrometItem[]>>(resp);
  return json?.data || [];
}

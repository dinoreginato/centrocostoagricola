export type OpenMeteoCurrentWeather = {
  temperatureC: number;
  humidityPercent: number;
  windSpeedKmh: number;
  weatherCode: number;
};

export async function fetchOpenMeteoCurrentWeather(params: { lat: number; lon: number }) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${params.lat}&longitude=${params.lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=America%2FSantiago`;
  const resp = await fetch(url, { headers: { accept: 'application/json' } });
  if (!resp.ok) throw new Error('No se pudo obtener el clima');
  const json = (await resp.json()) as any;
  const current = json?.current || {};

  return {
    temperatureC: Number(current.temperature_2m),
    humidityPercent: Number(current.relative_humidity_2m),
    windSpeedKmh: Number(current.wind_speed_10m),
    weatherCode: Number(current.weather_code)
  } satisfies OpenMeteoCurrentWeather;
}


import React, { useState, useEffect } from 'react';
import { Cloud, Sun, CloudRain, Wind, Droplets } from 'lucide-react';
import { fetchOpenMeteoCurrentWeather } from '../services/openMeteo';

interface WeatherData {
  temp: number;
  description: string;
  icon: string;
  humidity: number;
  windSpeed: number;
  location: string;
}

// We use Open-Meteo API as it doesn't require an API key for basic usage
// Coordinates are roughly set to Rengo, Chile (as seen in some invoices)
// You can adjust these coordinates if needed
const LAT = -34.4069;
const LON = -70.8586;

export const WeatherWidget: React.FC = () => {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchWeather = async () => {
      try {
        const current = await fetchOpenMeteoCurrentWeather({ lat: LAT, lon: LON });
        
        // Map WMO weather codes to our simplified icons/descriptions
        const code = current.weatherCode;
        let description = 'Despejado';
        let icon = 'sun';
        
        if (code >= 1 && code <= 3) { description = 'Parcialmente Nublado'; icon = 'cloud'; }
        else if (code >= 51 && code <= 67) { description = 'Llovizna'; icon = 'rain'; }
        else if (code >= 71 && code <= 82) { description = 'Lluvia'; icon = 'rain'; }
        else if (code >= 95) { description = 'Tormenta'; icon = 'rain'; }

        setWeather({
          temp: Math.round(current.temperatureC),
          description,
          icon,
          humidity: current.humidityPercent,
          windSpeed: Math.round(current.windSpeedKmh),
          location: 'Rengo, Chile' // Default location based on coordinates
        });
      } catch (_error) {
        void _error;
      } finally {
        setLoading(false);
      }
    };

    fetchWeather();
    // Refresh every hour
    const interval = setInterval(fetchWeather, 3600000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl shadow-lg p-6 text-white h-full flex items-center justify-center min-h-[160px]">
        <div className="animate-pulse flex space-x-4 items-center">
          <div className="rounded-full bg-blue-400 h-12 w-12"></div>
          <div className="flex-1 space-y-4 py-1">
            <div className="h-4 bg-blue-400 rounded w-3/4"></div>
            <div className="space-y-2">
              <div className="h-4 bg-blue-400 rounded"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!weather) return null;

  const WeatherIcon = () => {
    switch (weather.icon) {
      case 'sun': return <Sun className="w-12 h-12 text-yellow-300" />;
      case 'rain': return <CloudRain className="w-12 h-12 text-blue-200" />;
      default: return <Cloud className="w-12 h-12 text-gray-200" />;
    }
  };

  return (
    <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl shadow-lg p-6 text-white h-full relative overflow-hidden print:border print:border-gray-200 dark:border-gray-700 print:text-black print:bg-none print:bg-white dark:bg-gray-800 print:shadow-none">
      {/* Decorative background circle */}
      <div className="absolute -top-10 -right-10 w-32 h-32 bg-white dark:bg-gray-800 opacity-10 rounded-full blur-2xl print:hidden"></div>
      
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-blue-100 text-sm font-medium print:text-gray-500 dark:text-gray-400">Clima Actual</h3>
          <p className="text-sm font-medium opacity-90">{weather.location}</p>
        </div>
        <WeatherIcon />
      </div>

      <div className="flex items-end space-x-2 mb-4">
        <span className="text-5xl font-bold">{weather.temp}°</span>
        <span className="text-lg text-blue-100 mb-1 print:text-gray-600 dark:text-gray-400">{weather.description}</span>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm text-blue-100 print:text-gray-500 dark:text-gray-400 mt-auto">
        <div className="flex items-center">
          <Droplets className="w-4 h-4 mr-1 opacity-70" />
          <span>{weather.humidity}% Hum.</span>
        </div>
        <div className="flex items-center">
          <Wind className="w-4 h-4 mr-1 opacity-70" />
          <span>{weather.windSpeed} km/h</span>
        </div>
      </div>
    </div>
  );
};

const iconFor = code => {
  if ([0, 1].includes(code)) return '☀️';
  if ([2, 3].includes(code)) return '☁️';
  if ([45, 48].includes(code)) return '🌫️';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '🌧️';
  if ([95, 96, 99].includes(code)) return '⛈️';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '🌨️';
  return '🌤️';
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
  const city = String(req.query.city || 'Edinburgh').toLowerCase();
  const locations = {
    edinburgh: { name: 'Edinburgh', latitude: 55.9533, longitude: -3.1883 },
    istanbul: { name: 'İstanbul', latitude: 41.0082, longitude: 28.9784 }
  };
  const location = locations[city];
  if (!location) return res.status(400).json({ error: 'UNSUPPORTED_CITY' });

  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      current: 'temperature_2m,weather_code,is_day',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min',
      forecast_days: '5',
      temperature_unit: 'celsius',
      timezone: 'auto'
    });
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`FORECAST_${response.status}`);
    const forecast = await response.json();
    const current = forecast.current;
    return res.status(200).json({
      city: location.name,
      current: { temperature: current?.temperature_2m, icon: iconFor(current?.weather_code) },
      days: (forecast.daily?.time || []).map((date, index) => ({
        day: new Intl.DateTimeFormat('tr-TR', { weekday: 'short', timeZone: forecast.timezone || 'UTC' }).format(new Date(`${date}T12:00:00Z`)),
        icon: iconFor(forecast.daily.weather_code[index]),
        max: forecast.daily.temperature_2m_max[index],
        min: forecast.daily.temperature_2m_min[index]
      }))
    });
  } catch (error) {
    console.error('Weather API error:', error.message);
    return res.status(502).json({ error: 'FORECAST_UNAVAILABLE' });
  }
};

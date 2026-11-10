const iconFor = code => {
  if ([1, 2, 3, 4, 5].includes(code)) return '☀️';
  if ([6, 7, 8].includes(code)) return '☁️';
  if ([11].includes(code)) return '🌫️';
  if ([12, 13, 14, 18].includes(code)) return '🌧️';
  if ([15, 16, 17].includes(code)) return '⛈️';
  if ([19, 20, 21, 22, 23, 24, 25, 26, 29].includes(code)) return '🌨️';
  if ([30].includes(code)) return '🔥';
  if ([31].includes(code)) return '🥶';
  if ([32].includes(code)) return '💨';
  return '🌤️';
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
  const apiKey = process.env.ACCUWEATHER_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'API_KEY_MISSING' });

  const city = String(req.query.city || 'Edinburgh').toLowerCase();
  const locations = { edinburgh: 'Edinburgh', istanbul: 'Istanbul' };
  const searchCity = locations[city];
  if (!searchCity) return res.status(400).json({ error: 'UNSUPPORTED_CITY' });

  const base = 'https://dataservice.accuweather.com';
  const headers = { Authorization: `Bearer ${apiKey}` };
  try {
    const lookup = await fetch(`${base}/locations/v1/cities/search?apikey=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(searchCity)}&language=tr-tr`, { headers, signal: AbortSignal.timeout(8000) });
    if (!lookup.ok) throw new Error(`LOCATION_${lookup.status}`);
    const matches = await lookup.json();
    const location = matches[0];
    if (!location?.Key) throw new Error('LOCATION_NOT_FOUND');

    const [currentRes, forecastRes] = await Promise.all([
      fetch(`${base}/currentconditions/v1/${location.Key}?apikey=${encodeURIComponent(apiKey)}&language=tr-tr&details=true`, { headers, signal: AbortSignal.timeout(8000) }),
      fetch(`${base}/forecasts/v1/daily/5day/${location.Key}?apikey=${encodeURIComponent(apiKey)}&language=tr-tr&metric=true&details=true`, { headers, signal: AbortSignal.timeout(8000) })
    ]);
    if (!currentRes.ok || !forecastRes.ok) throw new Error('FORECAST_UNAVAILABLE');
    const [currentRows, forecast] = await Promise.all([currentRes.json(), forecastRes.json()]);
    const current = currentRows[0];
    return res.status(200).json({
      city: location.LocalizedName,
      current: { temperature: current?.Temperature?.Metric?.Value, icon: iconFor(current?.WeatherIcon) },
      days: (forecast.DailyForecasts || []).map(day => ({
        day: new Intl.DateTimeFormat('tr-TR', { weekday: 'short', timeZone: location.TimeZone?.Code || 'Europe/London' }).format(new Date(day.Date)),
        icon: iconFor(day.Day?.Icon),
        max: day.Temperature?.Maximum?.Value,
        min: day.Temperature?.Minimum?.Value
      }))
    });
  } catch (error) {
    console.error('Weather API error:', error.message);
    return res.status(502).json({ error: 'FORECAST_UNAVAILABLE' });
  }
};

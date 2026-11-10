const dns = require('node:dns').promises;
const net = require('node:net');

function isPublicAddress(address) {
  if (net.isIPv4(address)) {
    const parts = address.split('.').map(Number);
    return !(parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || parts[0] >= 224 ||
      (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127));
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith('::ffff:')) return isPublicAddress(normalized.slice(7));
    return normalized === '::1' || normalized === '::' ? false :
      !(normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('ff'));
  }
  return false;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  try {
    let imageUrl = new URL(String(req.query.url || ''));
    let response;
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (!['http:', 'https:'].includes(imageUrl.protocol) || imageUrl.username || imageUrl.password) return res.status(400).end();
      const host = imageUrl.hostname.toLowerCase();
      if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return res.status(400).end();
      const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
      if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) return res.status(400).end();

      response = await fetch(imageUrl, {
        redirect: 'manual',
        signal: AbortSignal.timeout(9000),
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; Daily360/1.0)', referer: `${imageUrl.origin}/` }
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      if (!location || redirects === 3) return res.status(404).end();
      imageUrl = new URL(location, imageUrl);
    }
    if (!response.ok) return res.status(404).end();
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return res.status(415).end();
    if (Number(response.headers.get('content-length') || 0) > 8 * 1024 * 1024) return res.status(413).end();
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 8 * 1024 * 1024) {
        await reader.cancel();
        return res.status(413).end();
      }
      chunks.push(Buffer.from(value));
    }
    const bytes = Buffer.concat(chunks, total);
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(bytes);
  } catch (error) {
    console.warn('Image proxy error:', error.message);
    return res.status(502).end();
  }
};

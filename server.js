// Gündem 360 - Kategoriye Özel Haber, Gerçek Fotoğraf & Özelleştirilebilir Kaynak Servisi
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const PORT = 4173;
const root = __dirname;

const cache = new Map();

const clean = s => String(s || '')
  .replace(/<!\[CDATA\[|\]\]>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
  .replace(/<[^>]+>/g, '').trim();

const value = (xml, name) => (xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i')) || [])[1] || '';

// RSS içindeki gerçek haber görselini çıkar
function extractRealImage(itemXml) {
  // 1. media:content
  const mediaContent = itemXml.match(/<media:content[^>]+url=["']([^"']+)["']/i);
  if (mediaContent && mediaContent[1]) {
    let img = mediaContent[1].replace(/&amp;/g, '&');
    if (img.includes('theguardian.com') || img.includes('guim.co.uk')) {
      img = img.replace(/width=\d+/, 'width=800');
    }
    return img;
  }

  // 2. media:thumbnail
  const mediaThumb = itemXml.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
  if (mediaThumb && mediaThumb[1]) {
    let img = mediaThumb[1].replace(/&amp;/g, '&');
    return img.replace(/\/240\//, '/800/').replace(/\/320\//, '/800/');
  }

  // 3. enclosure (Fotomaç, Sabah, TRT, Sky vb.)
  const enclosure = itemXml.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
  if (enclosure && enclosure[1] && !/\.(mp3|mp4|m4a|wav)/i.test(enclosure[1])) {
    return enclosure[1].replace(/&amp;/g, '&');
  }

  // 4. image tag
  const imageTag = itemXml.match(/<image>([^<]+)<\/image>/i);
  if (imageTag && imageTag[1]) {
    return imageTag[1].replace(/&amp;/g, '&');
  }

  // 5. img tag in description / content
  const imgTag = itemXml.match(/<img[^>]+src=["']([^"']+)["']/i)
    || itemXml.match(/&lt;img[^>]+src=&quot;([^&"]+)&quot;/i);
  if (imgTag && imgTag[1]) {
    return imgTag[1].replace(/&amp;/g, '&');
  }

  return null;
}

// Haberin orijinal sayfasından gerçek og:image görselini ve özetini çek
async function fetchArticleDetails(link, fallbackDesc) {
  try {
    const res = await fetch(link, {
      signal: AbortSignal.timeout(5000),
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const html = await res.text();
    
    const imgMatch = html.match(/<meta[^>]+(?:property=["']og:image["']|name=["']twitter:image["'])[^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property=["']og:image["']|name=["']twitter:image["'])/i);
    
    const descMatch = html.match(/<meta[^>]+(?:property=["']og:description["']|name=["']description["'])[^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property=["']og:description["']|name=["']description["'])/i);

    let img = imgMatch ? imgMatch[1].replace(/&amp;/g, '&') : null;
    if (img && img.startsWith('//')) img = 'https:' + img;

    return {
      imageUrl: img,
      description: clean(descMatch ? descMatch[1] : fallbackDesc)
    };
  } catch {
    return { imageUrl: null, description: fallbackDesc };
  }
}

async function translateToTurkish(text) {
  if (!text) return '';
  if (/[çğıöşüÇĞİÖŞÜ]/.test(text) && /\b(ve|ile|bir|bu|için|olan|olarak|göre|sonra|haftanın|maçı|lig)\b/i.test(text)) {
    return text;
  }
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=tr&dt=t&q=${encodeURIComponent(text.slice(0, 600))}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const result = await response.json();
    return Array.isArray(result?.[0]) ? result[0].map(part => part[0]).join('') : text;
  } catch {
    return text;
  }
}

// SPOR kategorisi için SADECE Şampiyonlar Ligi ve Türk Ligi (Süper Lig) akışları
const sportsExclusiveFeeds = [
  ['Şampiyonlar Ligi', 'https://www.fotomac.com.tr/rss/sampiyonlarligi.xml'],
  ['Süper Lig', 'https://www.fotomac.com.tr/rss/superlig.xml'],
  ['UEFA Champions League', 'https://feeds.bbci.co.uk/sport/football/champions-league/rss.xml'],
  ['Champions League', 'https://www.theguardian.com/football/championsleague/rss'],
  ['Süper Lig', 'https://www.sabah.com.tr/rss/spor.xml']
];

// Her kategori için tanımlı temel haber kaynakları
const categoryFeeds = {
  all: [
    ['BBC News', 'https://feeds.bbci.co.uk/news/rss.xml'],
    ['The Guardian', 'https://www.theguardian.com/world/rss'],
    ['The New York Times', 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml'],
    ['Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml'],
    ['Forbes', 'https://www.forbes.com/most-popular/feed/'],
    ['The Washington Post', 'https://feeds.washingtonpost.com/rss/world'],
    ['The Wall Street Journal', 'https://feeds.a.dj.com/rss/RSSWorldNews.xml'],
    ['Reuters', 'https://news.google.com/rss/search?q=site:reuters.com+when:3d&hl=en&gl=US&ceid=US:en'],
    ['The Economist', 'https://www.economist.com/international/rss.xml']
  ],
  world: [
    ['BBC News', 'https://feeds.bbci.co.uk/news/world/rss.xml'],
    ['The Guardian', 'https://www.theguardian.com/world/rss'],
    ['The New York Times', 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml'],
    ['Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml'],
    ['Reuters', 'https://news.google.com/rss/search?q=site:reuters.com+when:3d&hl=en&gl=US&ceid=US:en']
  ],
  turkey: [
    ['BBC Türkçe', 'https://feeds.bbci.co.uk/turkce/rss.xml'],
    ['TRT Haber', 'https://www.trthaber.com/gundem_articles.rss'],
    ['The Guardian', 'https://www.theguardian.com/world/turkey/rss']
  ],
  politics: [
    ['The Guardian', 'https://www.theguardian.com/politics/rss'],
    ['BBC News', 'https://feeds.bbci.co.uk/news/politics/rss.xml'],
    ['The New York Times', 'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml']
  ],
  policy: [
    ['The Guardian', 'https://www.theguardian.com/us-news/us-politics/rss'],
    ['BBC News', 'https://feeds.bbci.co.uk/news/politics/rss.xml'],
    ['The New York Times', 'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml']
  ],
  economy: [
    ['BBC News', 'https://feeds.bbci.co.uk/news/business/rss.xml'],
    ['The Guardian', 'https://www.theguardian.com/uk/business/rss'],
    ['The New York Times', 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml'],
    ['Forbes', 'https://www.forbes.com/business/feed/']
  ],
  sports: sportsExclusiveFeeds,
  health: [
    ['BBC News', 'https://feeds.bbci.co.uk/news/health/rss.xml'],
    ['The Guardian', 'https://www.theguardian.com/society/health/rss'],
    ['The New York Times', 'https://rss.nytimes.com/services/xml/rss/nyt/Health.xml']
  ],
  technology: [
    ['BBC News', 'https://feeds.bbci.co.uk/news/technology/rss.xml'],
    ['The Guardian', 'https://www.theguardian.com/technology/rss'],
    ['The New York Times', 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml'],
    ['Forbes', 'https://www.forbes.com/innovation/feed/']
  ],
  culture: [
    ['BBC News', 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml'],
    ['The Guardian', 'https://www.theguardian.com/culture/rss'],
    ['The New York Times', 'https://rss.nytimes.com/services/xml/rss/nyt/Arts.xml']
  ],
  uk: [
    ['Manchester Evening News', 'https://www.manchestereveningnews.co.uk/news/?service=rss'],
    ['Liverpool Echo', 'https://www.liverpoolecho.co.uk/news/?service=rss'],
    ['Bristol Post', 'https://www.bristolpost.co.uk/news/?service=rss'],
    ['The Yorkshire Post', 'https://www.yorkshirepost.co.uk/news/rss']
  ],
  scotland: [
    ['The Scotsman', 'https://www.scotsman.com/news/rss'],
    ['The Herald', 'https://www.heraldscotland.com/news/rss/'],
    ['Glasgow Live', 'https://www.glasgowlive.co.uk/news/?service=rss']
  ]
};

async function fetchFeed(source, url) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gundem360/4.0' }
    });
    if (!response.ok) return [];
    const xml = await response.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(match => {
      const item = match[1];
      return {
        title: clean(value(item, 'title')),
        link: clean(value(item, 'link')),
        description: clean(value(item, 'description')),
        pubDate: clean(value(item, 'pubDate')) || new Date().toISOString(),
        source,
        imageUrl: extractRealImage(item)
      };
    }).filter(item => item.title && item.link);
  } catch {
    return [];
  }
}

async function news(category, userSources, customFeeds) {
  // SPOR kategorisi doğrudan Şampiyonlar Ligi ve Türk Ligi kaynaklarını kullanır
  const isSports = category === 'sports';
  const feedsToQuery = isSports ? sportsExclusiveFeeds : (categoryFeeds[category] || categoryFeeds.all);

  let activeFeeds = [...feedsToQuery];
  if (!isSports) {
    if (Array.isArray(customFeeds) && customFeeds.length > 0) {
      customFeeds.forEach(cf => {
        if (cf.name && cf.url) activeFeeds.push([cf.name, cf.url]);
      });
    }
    if (Array.isArray(userSources) && userSources.length > 0) {
      const filtered = activeFeeds.filter(([sourceName]) => userSources.includes(sourceName));
      if (filtered.length > 0) activeFeeds = filtered;
    }
  }

  const results = await Promise.allSettled(activeFeeds.map(([source, url]) => fetchFeed(source, url)));

  const seen = new Set();
  const rawItems = results
    .flatMap(r => r.status === 'fulfilled' ? r.value : [])
    .filter(item => {
      const id = item.title.toLowerCase();
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  // Görseli eksik olanlar için doğrudan sayfadan og:image çek
  const enriched = await Promise.all(rawItems.slice(0, 36).map(async item => {
    if (!item.imageUrl) {
      const details = await fetchArticleDetails(item.link, item.description);
      return {
        ...item,
        imageUrl: details.imageUrl,
        description: details.description || item.description
      };
    }
    return item;
  }));

  // Sadece gerçek görseli olan haberleri tut
  let withImages = enriched.filter(item => Boolean(item.imageUrl));

  // Spor sekmesinde Şampiyonlar Ligi ve Türk Ligi haberlerini dengeli olarak harmanla
  if (isSports) {
    const isCl = item => {
      const text = (item.title + ' ' + (item.description || '') + ' ' + item.source).toLowerCase();
      return text.includes('şampiyonlar ligi') || text.includes('champions league') || text.includes('uefa');
    };
    const clItems = withImages.filter(isCl);
    const trLeagueItems = withImages.filter(item => !isCl(item));

    const blended = [];
    const maxLen = Math.max(clItems.length, trLeagueItems.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < trLeagueItems.length) blended.push(trLeagueItems[i]);
      if (i < clItems.length) blended.push(clItems[i]);
    }
    withImages = blended;
  }

  const finalItems = withImages.slice(0, 30);

  // Başlıkları ve özetleri Türkçeye çevir
  const translated = await Promise.all(finalItems.map(async item => ({
    ...item,
    title: await translateToTurkish(item.title),
    description: await translateToTurkish(item.description)
  })));

  return translated;
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  if (url.pathname === '/api/news') {
    try {
      const category = url.searchParams.get('category') || 'all';
      const sourcesParam = url.searchParams.get('sources');
      const userSources = sourcesParam ? sourcesParam.split(',').map(s => s.trim()).filter(Boolean) : null;
      
      let customFeeds = null;
      const customParam = url.searchParams.get('customFeeds');
      if (customParam) {
        try { customFeeds = JSON.parse(customParam); } catch {}
      }

      const items = await news(category, userSources, customFeeds);
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      });
      res.end(JSON.stringify({ items, updatedAt: new Date().toISOString() }));
    } catch (error) {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Haber akışı şu an alınamadı: ' + error.message }));
    }
    return;
  }

  const target = path.resolve(root, url.pathname === '/' ? 'index.html' : '.' + url.pathname);
  if (!target.startsWith(root) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    res.writeHead(404);
    res.end('Bulunamadı');
    return;
  }
  res.writeHead(200, { 'content-type': mime[path.extname(target)] || 'application/octet-stream' });
  fs.createReadStream(target).pipe(res);
}).listen(PORT, () => console.log(`Gündem 360: http://localhost:${PORT}`));

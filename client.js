// Gündem 360° — İstemci Kontrolcüsü (Kaynak Yönetimi & Özelleştirme)

const intlSources = [
  'The New York Times', 'The Guardian', 'Forbes', 'BBC News',
  'The Washington Post', 'Financial Times', 'The Wall Street Journal',
  'Reuters', 'The Economist', 'Al Jazeera'
];

const trSportsSources = [
  'BBC Türkçe', 'TRT Haber', 'BBC Sport', 'Sky Sports'
];

const localSources = [
  'The Scotsman', 'The Herald', 'Glasgow Live',
  'Manchester Evening News', 'Liverpool Echo', 'The Yorkshire Post', 'Bristol Post'
];

const categories = {
  all: 'Manşetler',
  world: 'Dünya',
  turkey: 'Türkiye',
  politics: 'Siyaset',
  policy: 'Politika',
  economy: 'Ekonomi',
  sports: 'Spor',
  health: 'Sağlık',
  technology: 'Teknoloji',
  culture: 'Kültür & Sanat',
  uk: 'UK Yerel',
  scotland: 'Scotland'
};

let activeCategory = 'all';
let allItems = [];
let bookmarks = new Set(JSON.parse(localStorage.getItem('gundem360_bookmarks') || '[]'));

// Kullanıcının kapattığı / çıkardığı kaynaklar
let disabledSources = new Set(JSON.parse(localStorage.getItem('gundem360_disabled_sources') || '[]'));

// Kullanıcının kendisinin ilave ettiği özel RSS kaynakları: [{ name, url }]
let customSources = JSON.parse(localStorage.getItem('gundem360_custom_sources') || '[]');

// Sayfa dosya sistemi üzerinden (file:) açıldıysa doğrudan localhost sunucusuna yönlendir
if (location.protocol === 'file:') {
  location.replace('http://localhost:4173/');
}

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

function relativeTime(pubDate) {
  const diffMinutes = Math.max(1, Math.round((Date.now() - new Date(pubDate)) / 60000));
  if (diffMinutes < 60) return `${diffMinutes} DK`;
  if (diffMinutes < 1440) return `${Math.round(diffMinutes / 60)} SA`;
  return `${Math.round(diffMinutes / 1440)} GÜN`;
}

function setupDate() {
  const dateEl = $('#today');
  const clockEl = $('#clock');
  const updateClock = () => {
    const now = new Date();
    const formatted = new Intl.DateTimeFormat('tr-TR', {
      day: 'numeric', month: 'long', year: 'numeric', weekday: 'long'
    }).format(now);
    dateEl.firstChild.textContent = `${formatted.toUpperCase()} `;
    clockEl.textContent = new Intl.DateTimeFormat('tr-TR', {
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(now);
  };
  updateClock();
  window.setInterval(updateClock, 30_000);
}

function setupTabs() {
  const tabsContainer = $('#tabs');
  tabsContainer.innerHTML = Object.entries(categories).map(([key, name]) => {
    const isActive = key === activeCategory ? 'active' : '';
    return `<button class="tab-btn ${isActive}" data-cat="${key}">${name}</button>`;
  }).join('');

  tabsContainer.addEventListener('click', e => {
    const btn = e.target.closest('.tab-btn');
    if (!btn || btn.dataset.cat === activeCategory) return;
    
    activeCategory = btn.dataset.cat;
    $$('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    loadNews();
  });
}

// Kaynak Butonu (Pill) HTML Oluşturucu
function renderSourcePill(name, isCustom = false) {
  const isEnabled = !disabledSources.has(name);
  const activeClass = isEnabled ? 'active' : 'inactive';
  const checkIcon = isEnabled ? '<span class="tag-check">✓</span>' : '<span class="tag-check">+</span>';
  const deleteBtn = isCustom ? `<button class="tag-delete-btn" data-del="${name}" title="Kaynağı Sil">✕</button>` : '';

  return `
    <span class="source-tag-item ${activeClass}" data-name="${name}">
      ${checkIcon}
      <span class="tag-label">${name}</span>
      ${deleteBtn}
    </span>
  `;
}

function renderAllSourceTags() {
  $('#intlSourceTags').innerHTML = intlSources.map(s => renderSourcePill(s)).join('');
  $('#trSportsSourceTags').innerHTML = trSportsSources.map(s => renderSourcePill(s)).join('');
  $('#localSourceTags').innerHTML = localSources.map(s => renderSourcePill(s)).join('');

  if (customSources.length > 0) {
    $('#customGroup').style.display = 'block';
    $('#customSourceTags').innerHTML = customSources.map(s => renderSourcePill(s.name, true)).join('');
  } else {
    $('#customGroup').style.display = 'none';
  }
}

function setupModal() {
  const modal = $('#preferences');
  $('#openSettings').onclick = () => {
    renderAllSourceTags();
    modal.showModal();
  };
  $('#closePrefs').onclick = () => modal.close();
  $('#savePrefs').onclick = () => {
    modal.close();
    loadNews();
  };

  modal.addEventListener('click', e => {
    if (e.target === modal) {
      modal.close();
      loadNews();
    }
  });

  // Kaynak seçme / çıkarma (Toggle) veya özel kaynak silme
  modal.addEventListener('click', e => {
    // Özel kaynak silme butonu
    const delBtn = e.target.closest('.tag-delete-btn');
    if (delBtn) {
      e.stopPropagation();
      const targetName = delBtn.dataset.del;
      customSources = customSources.filter(s => s.name !== targetName);
      disabledSources.delete(targetName);
      localStorage.setItem('gundem360_custom_sources', JSON.stringify(customSources));
      localStorage.setItem('gundem360_disabled_sources', JSON.stringify([...disabledSources]));
      renderAllSourceTags();
      return;
    }

    // Kaynağı açıp kapatma (dahil et / çıkar)
    const pill = e.target.closest('.source-tag-item');
    if (pill) {
      const sourceName = pill.dataset.name;
      if (disabledSources.has(sourceName)) {
        disabledSources.delete(sourceName); // Tekrar dahil et
      } else {
        disabledSources.add(sourceName); // Akıştan çıkar
      }
      localStorage.setItem('gundem360_disabled_sources', JSON.stringify([...disabledSources]));
      renderAllSourceTags();
    }
  });

  // Yeni Kaynak Ekleme
  const addBtn = $('#addSourceBtn');
  const nameInput = $('#newSourceName');
  const urlInput = $('#newSourceUrl');

  function addNewSource(name, url) {
    const cleanName = (name || '').trim();
    const cleanUrl = (url || '').trim();

    if (!cleanName || !cleanUrl) {
      alert('Lütfen hem kaynak adını hem de geçerli bir RSS bağlantısını girin.');
      return;
    }
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      alert('RSS bağlantısı http:// veya https:// ile başlamalıdır.');
      return;
    }

    // Zaten var mı kontrol et
    if (customSources.some(s => s.name.toLowerCase() === cleanName.toLowerCase())) {
      alert('Bu isimde bir kaynak zaten eklenmiş.');
      return;
    }

    customSources.push({ name: cleanName, url: cleanUrl });
    disabledSources.delete(cleanName); // Yeni eklenen varsayılan olarak açık gelsin
    localStorage.setItem('gundem360_custom_sources', JSON.stringify(customSources));
    localStorage.setItem('gundem360_disabled_sources', JSON.stringify([...disabledSources]));
    
    nameInput.value = '';
    urlInput.value = '';
    renderAllSourceTags();
  }

  addBtn.onclick = () => addNewSource(nameInput.value, urlInput.value);

  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') urlInput.focus();
  });
  urlInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') addNewSource(nameInput.value, urlInput.value);
  });

  // Hızlı Ekleme Önerileri
  $$('.quick-preset').forEach(span => {
    span.onclick = () => {
      addNewSource(span.dataset.name, span.dataset.url);
    };
  });

  // Varsayılana Sıfırla
  $('#resetSourcesBtn').onclick = () => {
    if (confirm('Tüm kaynak tercihleri ve özel eklenen kaynaklar varsayılana sıfırlansın mı?')) {
      disabledSources.clear();
      customSources = [];
      localStorage.removeItem('gundem360_disabled_sources');
      localStorage.removeItem('gundem360_custom_sources');
      renderAllSourceTags();
      loadNews();
    }
  };
}

function setupActions() {
  $('#refreshBtn').onclick = () => loadNews();
  
  $('#highlightsBtn').onclick = () => {
    const firstStory = $('.news-card');
    if (firstStory) {
      firstStory.scrollIntoView({ behavior: 'smooth', block: 'center' });
      firstStory.style.transition = 'box-shadow 0.3s';
      firstStory.style.boxShadow = '0 0 0 3px var(--accent-green)';
      setTimeout(() => firstStory.style.boxShadow = '', 1500);
    }
  };

  $('#searchBtn').onclick = () => {
    const term = prompt('Başlıklarda ara:');
    if (term === null) return;
    if (!term.trim()) {
      renderCards(allItems);
      return;
    }
    const q = term.toLowerCase().trim();
    const filtered = allItems.filter(item =>
      item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)
    );
    $('#feedStatusText').textContent = `"${term}" için ${filtered.length} sonuç bulundu`;
    renderCards(filtered);
  };
}

async function loadNews() {
  const statusEl = $('#feedStatusText');
  const storiesGrid = $('#stories');
  
  statusEl.textContent = 'Günün haberleri kaynaklardan toplanıyor…';
  storiesGrid.innerHTML = `
    <div style="grid-column: 1 / -1; padding: 60px 0; text-align: center; color: var(--ink-muted);">
      <div class="pulse-dot" style="width: 12px; height: 12px; margin-bottom: 12px;"></div>
      <p style="font-size: 14px; font-weight: 600;">Seçili yayınlardan haberler ve fotoğraflar yükleniyor…</p>
    </div>
  `;

  try {
    // Aktif tüm kaynakların listesi
    const allKnown = [...intlSources, ...trSportsSources, ...localSources, ...customSources.map(s => s.name)];
    const activeList = allKnown.filter(s => !disabledSources.has(s));

    const params = new URLSearchParams({
      category: activeCategory,
      sources: activeList.join(',')
    });

    if (customSources.length > 0) {
      params.set('customFeeds', JSON.stringify(customSources));
    }

    const res = await fetch(`/api/news?${params}`);
    if (!res.ok) throw new Error('API yanıt vermedi');
    const data = await res.json();
    
    if (!data.items || !data.items.length) {
      storiesGrid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 50px 20px; background: #fff; border-radius: 14px; border: 1px solid var(--border-card); text-align: center;">
          <h3 style="font-family: var(--font-serif); font-size: 20px; margin-bottom: 8px;">Seçili yayınlarda haber bulunamadı</h3>
          <p style="color: var(--ink-secondary); font-size: 14px; margin-bottom: 18px;">
            Bu kategori için seçtiğiniz tüm yayınları kapatmış olabilirsiniz. Yayınlar menüsünden kontrol edebilirsiniz.
          </p>
          <button class="pill-btn" onclick="$('#preferences').showModal()">Yayın Tercihlerini Aç</button>
        </div>
      `;
      statusEl.textContent = `0 haber bulundu`;
      return;
    }

    // Spor kategorisinde genel uluslararası gazete filtrelerini devre dışı bırak
    allItems = data.items.filter(item => {
      if (activeCategory === 'sports') return true;
      return !disabledSources.has(item.source);
    });
    statusEl.textContent = `Son güncelleme: şimdi · ${allItems.length} haber`;
    renderCards(allItems);
  } catch (err) {
    statusEl.textContent = 'Haber akışına şu an ulaşılamadı';
    storiesGrid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 40px; background: #fff; border-radius: 14px; border: 1px solid var(--border-card); text-align: center;">
        <h3 style="font-family: var(--font-serif); font-size: 20px; margin-bottom: 8px;">Haber akışı yenileniyor</h3>
        <p style="color: var(--ink-secondary); font-size: 14px; margin-bottom: 16px;">
          Lütfen birkaç saniye sonra tekrar deneyin veya sunucunun çalıştığını kontrol edin.
        </p>
        <button class="pill-btn" onclick="loadNews()">Tekrar Dene</button>
      </div>
    `;
  }
}

function renderCards(items) {
  const storiesGrid = $('#stories');
  storiesGrid.innerHTML = '';
  
  if (!items.length) {
    storiesGrid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--ink-muted);">
        Bu kategoride gösterilecek haber bulunamadı.
      </div>
    `;
    return;
  }

  const tmpl = $('#cardTmpl');

  items.forEach(item => {
    const clone = tmpl.content.cloneNode(true);
    const cardEl = clone.querySelector('.news-card');

    const imgEl = clone.querySelector('.card-image');
    imgEl.src = item.imageUrl;
    imgEl.alt = item.title;
    imgEl.onerror = () => {
      cardEl.querySelector('.card-media').style.display = 'none';
    };

    const catName = categories[activeCategory] || 'GÜNDEM';
    clone.querySelector('.category-tag').textContent = catName;
    clone.querySelector('.source-tag').textContent = item.source || 'DÜNYA BASINI';
    clone.querySelector('.time-tag').textContent = relativeTime(item.pubDate);

    const bookmarkBtn = clone.querySelector('.bookmark-btn');
    const isSaved = bookmarks.has(item.link);
    if (isSaved) bookmarkBtn.classList.add('saved');

    bookmarkBtn.onclick = (e) => {
      e.stopPropagation();
      if (bookmarks.has(item.link)) {
        bookmarks.delete(item.link);
        bookmarkBtn.classList.remove('saved');
      } else {
        bookmarks.add(item.link);
        bookmarkBtn.classList.add('saved');
      }
      localStorage.setItem('gundem360_bookmarks', JSON.stringify([...bookmarks]));
    };

    const headlineLink = clone.querySelector('.headline-link');
    headlineLink.textContent = item.title;
    headlineLink.href = item.link;

    const summary = clone.querySelector('.card-summary');
    const cleanSummary = (item.description || '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    summary.textContent = cleanSummary;

    clone.querySelector('.read-more-link').href = item.link;

    storiesGrid.appendChild(clone);
  });
}

function setupTheme() {
  const savedTheme = localStorage.getItem('gundem360_theme') ||
    (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', savedTheme);

  const toggleBtn = $('#themeToggleBtn');
  if (toggleBtn) {
    toggleBtn.onclick = () => {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('gundem360_theme', next);
    };
  }
}

// Başlat
setupTheme();
setupDate();
setupTabs();
setupModal();
setupActions();
loadNews();

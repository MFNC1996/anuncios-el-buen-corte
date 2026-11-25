(() => {
  const stage = document.getElementById('stage');
  const slideArea = document.getElementById('slide-area');
  const stageHeader = document.getElementById('stage-header');
  const stageTitle = document.getElementById('stage-title');
  const screenId = (location.pathname.match(/\/player\/(\d+)/) || [, '1'])[1];
  const PLACEHOLDER_PHOTO = '/shared/brand/placeholder.svg';

  // El cartel de MACOEM (proveedor del software) se agrega siempre acá, en
  // el código del reproductor — nunca como una fila en playlist_slides —
  // para que no aparezca como un cartel más en "Orden en pantalla" que se
  // pueda editar, mover de contenido o borrar desde el panel.
  const MACOEM_AD_SLIDE = {
    id: 'macoem-ad',
    category_id: null,
    template_key: 'macoem',
    animation_key: 'fade',
    duration_seconds: 9,
  };

  const state = {
    playlistId: null,
    slides: [],
    categoriesById: {},
    itemsByCategory: {},
    settings: null,
    index: 0,
    timer: null,
    currentEl: null,
  };

  function formatPrice(price) {
    return '$' + Number(price || 0).toLocaleString('es-CL');
  }

  // El título del encabezado se calcula aparte y se aplica al #stage-header
  // fijo (fuera del área animada) — así el logo nunca se mueve, escala ni se
  // recorta junto con las transiciones del contenido.
  const FIXED_TITLES = {
    horario: 'Horario de atención',
    redes: 'Síguenos en nuestras redes',
    qr: 'Únete a nuestro grupo de WhatsApp',
  };

  function headerTitleFor(slide) {
    if (FIXED_TITLES[slide.template_key]) return FIXED_TITLES[slide.template_key];
    if (slide.template_key === 'portada' || slide.template_key === 'destacado' || slide.template_key === 'imagen' || slide.template_key === 'macoem') return null;
    const category = state.categoriesById[slide.category_id];
    return category ? category.name : null;
  }

  function emptyStateHtml(message) {
    return `<div class="board board--grid"><div class="empty-state">${escapeHtml(message)}</div></div>`;
  }

  function renderGrid(category) {
    const items = state.itemsByCategory[category.id] || [];
    if (!items.length) return emptyStateHtml(`Pronto nuevas novedades en ${category.name}`);
    const cards = items
      .map(
        (item) => `
      <div class="item-card">
        <img class="item-photo" src="${escapeHtml(item.photo_path || PLACEHOLDER_PHOTO)}" alt="${escapeHtml(item.name)}" />
        <div class="item-body">
          <div class="item-name">${escapeHtml(item.name)}</div>
          <div class="item-price-row">
            <span class="item-price">${formatPrice(item.price)}</span>
            <span class="item-unit">/ ${escapeHtml(item.unit)}</span>
          </div>
        </div>
      </div>`
      )
      .join('');
    return `<div class="board board--grid"><div class="items-grid">${cards}</div></div>`;
  }

  function renderLista(category) {
    const items = state.itemsByCategory[category.id] || [];
    if (!items.length) return emptyStateHtml(`Pronto nuevas novedades en ${category.name}`);
    const rows = items
      .map(
        (item) => `
      <div class="list-row">
        <span class="list-name">${escapeHtml(item.name)}</span>
        <span class="list-dots"></span>
        <span class="list-price">${formatPrice(item.price)}</span>
        <span class="list-unit">/ ${escapeHtml(item.unit)}</span>
      </div>`
      )
      .join('');
    return `<div class="board board--lista"><div class="items-list">${rows}</div></div>`;
  }

  function renderDestacado(category) {
    const items = state.itemsByCategory[category.id] || [];
    if (!items.length) return emptyStateHtml(`Pronto nuevas novedades en ${category.name}`);
    const item = items[0];
    return `
      <div class="board board--destacado">
        <img class="hero-photo" src="${escapeHtml(item.photo_path || PLACEHOLDER_PHOTO)}" alt="${escapeHtml(item.name)}" />
        <div class="badge-oferta">OFERTA</div>
        <div class="hero-overlay">
          <div class="hero-eyebrow">${escapeHtml(category.name)}</div>
          <h1 class="hero-name">${escapeHtml(item.name)}</h1>
          <div class="hero-price-row">
            <span class="hero-price">${formatPrice(item.price)}</span>
            <span class="hero-unit">/ ${escapeHtml(item.unit)}</span>
          </div>
        </div>
      </div>`;
  }

  function renderRedes() {
    const s = state.settings;
    if (!s || (!s.instagram && !s.facebook)) {
      return emptyStateHtml('Configura tus redes sociales desde el panel');
    }
    const rows = [
      s.instagram ? { badge: 'IG', label: s.instagram, cls: 'social-instagram' } : null,
      s.facebook ? { badge: 'FB', label: s.facebook, cls: 'social-facebook' } : null,
    ].filter(Boolean);

    const items = rows
      .map(
        (r) => `
      <div class="social-row ${r.cls}">
        <span class="social-badge">${r.badge}</span>
        <span class="social-label">${escapeHtml(r.label)}</span>
      </div>`
      )
      .join('');

    return `
      <div class="board board--redes">
        <div class="redes-body">
          <img class="redes-logo" src="/shared/brand/logo.png" alt="" />
          <div class="social-list">${items}</div>
        </div>
      </div>`;
  }

  function renderHorario() {
    const hours = (state.settings && state.settings.hours) || [];
    if (!hours.length) return emptyStateHtml('Configura tu horario desde el panel');
    const rows = hours
      .map(
        (h) => `
      <div class="hours-row">
        <span class="hours-day">${escapeHtml(h.day)}</span>
        ${
          h.closed
            ? '<span class="hours-closed">Cerrado</span>'
            : `<span class="hours-time">${escapeHtml(h.open)} – ${escapeHtml(h.close)}</span>`
        }
      </div>`
      )
      .join('');
    return `<div class="board board--horario"><div class="hours-list">${rows}</div></div>`;
  }

  function renderQr() {
    const s = state.settings;
    if (!s || !s.whatsapp_qr_data_url) {
      return emptyStateHtml('Configura el link del grupo de WhatsApp desde el panel');
    }
    return `
      <div class="board board--qr">
        <div class="qr-body">
          <img class="qr-image" src="${s.whatsapp_qr_data_url}" alt="Código QR del grupo de WhatsApp" />
          <p class="qr-caption">Escanea el código con la cámara de tu celular${s.whatsapp_display ? ` o escríbenos al ${escapeHtml(s.whatsapp_display)}` : ''}</p>
        </div>
      </div>`;
  }

  function renderImagenLibre(slide) {
    if (!slide.photo_path) return emptyStateHtml('Sube una imagen para este cartel desde el panel');
    return `
      <div class="board board--imagen">
        <img class="imagen-libre-photo" src="${escapeHtml(slide.photo_path)}" alt="" />
      </div>`;
  }

  // Cartel publicitario de MACOEM (el proveedor del software).
  function renderMacoemAd() {
    return `
      <div class="board board--macoem">
        <div class="macoem-content">
          <div class="macoem-hex-wrap">
            <img class="macoem-logo-img" src="/shared/brand/macoem-logo.png" alt="MACOEM" />
          </div>
          <h1 class="macoem-wordmark">MACOEM</h1>
          <p class="macoem-tagline">Soluciones digitales para tu negocio</p>
          <p class="macoem-contact">+56 9 4863 4973 &nbsp;·&nbsp; @macoem.cl</p>
        </div>
      </div>`;
  }

  function renderPortada() {
    return `
      <div class="board board--portada">
        <div class="portada-content">
          <img class="portada-logo" src="/shared/brand/logo.png" alt="El Buen Corte" />
          <h1 class="portada-title">Carnicería El Buen Corte</h1>
          <p class="portada-sub">Loncoche — Calidad y frescura en cada corte</p>
        </div>
      </div>`;
  }

  function renderSlideHtml(slide) {
    if (slide.template_key === 'redes') return renderRedes();
    if (slide.template_key === 'horario') return renderHorario();
    if (slide.template_key === 'qr') return renderQr();
    if (slide.template_key === 'imagen') return renderImagenLibre(slide);
    if (slide.template_key === 'macoem') return renderMacoemAd();
    if (slide.template_key === 'portada' || !slide.category_id) return renderPortada();
    const category = state.categoriesById[slide.category_id];
    if (!category) return renderPortada();
    if (slide.template_key === 'lista') return renderLista(category);
    if (slide.template_key === 'destacado') return renderDestacado(category);
    return renderGrid(category);
  }

  function updateHeader(slide) {
    const title = headerTitleFor(slide);
    if (title) {
      stageTitle.textContent = title;
      stageHeader.hidden = false;
    } else {
      stageHeader.hidden = true;
    }
  }

  // El navegador viejo de algunas TVs Samsung calcula mal "grid-auto-rows:
  // 1fr" cuando el contenido de cada celda (foto con flex:1 + texto) es
  // flexible: el total se pasaba por un poco del alto real disponible y la
  // última fila quedaba cortada justo en el borde de la pantalla, sin forma
  // de verlo venir solo mirando el CSS. Midiendo acá con JS y fijando
  // "grid-template-rows" en píxeles exactos no hay margen de error posible
  // — se reparte EXACTAMENTE el alto medido, nunca más ni menos.
  function fitGridRows(container) {
    const grid = container.querySelector('.items-grid');
    if (!grid) return;
    const cardCount = grid.querySelectorAll('.item-card').length;
    if (!cardCount) return;
    const cols = 3;
    const rows = Math.ceil(cardCount / cols);
    const cs = getComputedStyle(grid);
    const paddingTop = parseFloat(cs.paddingTop) || 0;
    const paddingBottom = parseFloat(cs.paddingBottom) || 0;
    const rowGap = parseFloat(cs.rowGap) || 0;
    const contentHeight = grid.clientHeight - paddingTop - paddingBottom;
    const rowHeight = Math.max(10, (contentHeight - rowGap * (rows - 1)) / rows);
    grid.style.gridTemplateRows = `repeat(${rows}, ${rowHeight}px)`;
  }

  function showSlide(index, { restartTimer = true } = {}) {
    if (!state.slides.length) return;
    state.index = ((index % state.slides.length) + state.slides.length) % state.slides.length;
    const slide = state.slides[state.index];

    updateHeader(slide);

    const el = document.createElement('div');
    el.className = 'slide';
    el.dataset.animation = slide.animation_key || 'fade';
    el.innerHTML = renderSlideHtml(slide);
    slideArea.appendChild(el);

    const previousEl = state.currentEl;
    // Forzar reflow ANTES de medir el grid (fitGridRows) — sin esto, en el
    // navegador viejo de algunas TVs Samsung "clientHeight" podía devolver
    // un valor de antes de insertar este slide (o 0), midiendo mal el alto
    // real disponible y dejando el problema sin arreglar en la práctica.
    // eslint-disable-next-line no-unused-expressions
    el.offsetHeight;
    fitGridRows(el);
    el.classList.add('is-active');

    if (previousEl) {
      previousEl.classList.remove('is-active');
      previousEl.classList.add('is-leaving');
      setTimeout(() => previousEl.remove(), 900);
    }

    state.currentEl = el;

    if (restartTimer) {
      clearTimeout(state.timer);
      const durationMs = Math.max(2, slide.duration_seconds == null ? 8 : slide.duration_seconds) * 1000;
      state.timer = setTimeout(() => showSlide(state.index + 1), durationMs);
    }
  }

  function rerenderCurrentSlide() {
    if (!state.currentEl || !state.slides.length) return;
    const slide = state.slides[state.index];
    updateHeader(slide);
    state.currentEl.innerHTML = renderSlideHtml(slide);
    fitGridRows(state.currentEl);
  }

  function applyBackground(settings) {
    if (settings.background_image_path) {
      stage.style.setProperty('--ebc-bg-image', `url('${settings.background_image_path}')`);
      const opacityPercent = settings.background_overlay_opacity == null ? 80 : settings.background_overlay_opacity;
      stage.style.setProperty('--ebc-bg-overlay-alpha', String(opacityPercent / 100));
    } else {
      stage.style.removeProperty('--ebc-bg-image');
      stage.style.removeProperty('--ebc-bg-overlay-alpha');
    }
  }

  async function loadContent() {
    const [categories, items, settings] = await Promise.all([
      fetch('/api/categories').then((r) => r.json()),
      fetch('/api/items').then((r) => r.json()),
      fetch('/api/settings').then((r) => r.json()),
    ]);
    state.categoriesById = {};
    categories.forEach((c) => (state.categoriesById[c.id] = c));
    state.itemsByCategory = {};
    items.forEach((item) => {
      if (!state.itemsByCategory[item.category_id]) state.itemsByCategory[item.category_id] = [];
      state.itemsByCategory[item.category_id].push(item);
    });
    state.settings = settings;
    applyBackground(settings);
  }

  // Modo mosaico: varias pantallas puestas juntas muestran una sola imagen
  // grande, cada una recortando el pedazo que le toca según su posición
  // dentro del perfil. Técnica estándar de "video wall" en CSS: la imagen se
  // agranda a (columnas x 100%, filas x 100%) del tamaño de esta pantalla, y
  // se la corre con background-position para que cada una vea solo su parte.
  async function renderMosaic(screen) {
    clearTimeout(state.timer);
    stageHeader.hidden = true;

    const profile = await fetch(`/api/profiles/${screen.profile_id}`).then((r) => r.json());
    if (!profile.mosaic_image_path) {
      slideArea.innerHTML = emptyStateHtml('Sube la imagen del mosaico desde el panel (pestaña Pantallas)');
      return;
    }

    const screens = profile.screens || [];
    const rows = Math.max(1, ...screens.map((s) => (s.position_row == null ? 0 : s.position_row) + 1));
    const cols = Math.max(1, ...screens.map((s) => (s.position_col == null ? 0 : s.position_col) + 1));
    const row = screen.position_row == null ? 0 : screen.position_row;
    const col = screen.position_col == null ? 0 : screen.position_col;

    slideArea.innerHTML = '<div class="board board--mosaic-tile"></div>';
    const tile = slideArea.querySelector('.board--mosaic-tile');
    tile.style.backgroundImage = `url('${profile.mosaic_image_path}')`;
    tile.style.backgroundSize = `${cols * 100}% ${rows * 100}%`;
    tile.style.backgroundPosition = `${cols > 1 ? (col / (cols - 1)) * 100 : 0}% ${rows > 1 ? (row / (rows - 1)) * 100 : 0}%`;
  }

  async function loadPlaylist({ keepIndex = false } = {}) {
    const screen = await fetch(`/api/screens/${screenId}`).then((r) => r.json());
    if (!screen) return;
    state.screen = screen;

    if (screen.profile && screen.profile.mode === 'mosaic') {
      await renderMosaic(screen);
      return;
    }

    if (!screen.active_playlist_id) {
      state.slides = [];
      stageHeader.hidden = true;
      slideArea.innerHTML = '<div class="board board--portada"><div class="portada-content"><p class="portada-sub">Sin playlist asignada</p></div></div>';
      return;
    }
    state.playlistId = screen.active_playlist_id;
    const playlist = await fetch(`/api/playlists/${state.playlistId}`).then((r) => r.json());
    state.slides = [...(playlist.slides || []), MACOEM_AD_SLIDE];
    showSlide(keepIndex ? state.index : 0);
  }

  function connectWs() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${location.host}/ws`);

    socket.addEventListener('message', async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (err) {
        return;
      }
      if (msg.event === 'content:changed') {
        await loadContent();
        rerenderCurrentSlide();
      } else if (msg.event === 'playlist:changed' && msg.payload && msg.payload.playlist_id === state.playlistId) {
        await loadContent();
        await loadPlaylist({ keepIndex: false });
      } else if (msg.event === 'profiles:changed') {
        // Cambió algo de perfiles/pantallas (imagen de mosaico, arreglo,
        // a qué perfil pertenece esta pantalla, etc.) — recargar por si
        // afecta a esta pantalla en particular.
        await loadPlaylist({ keepIndex: true });
      }
    });

    socket.addEventListener('close', () => setTimeout(connectWs, 3000));
    socket.addEventListener('error', () => socket.close());
  }

  // Al probar la cartelera en un PC normal (no en la TV), mantener Escape
  // apretado ~1.5s vuelve al panel en vez de tener que cerrar la pestaña y
  // abrirla de nuevo. Exige sostenerlo (no un solo keydown) a propósito: en
  // la TV real esta misma página corre dentro de la app Tizen, y un control
  // remoto o dongle que mapee su botón "volver"/"atrás" a Escape no debe
  // poder sacar a un cliente de la cartelera con una sola pulsación.
  const ESCAPE_HOLD_MS = 1500;
  let escapeHoldTimer = null;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.repeat || escapeHoldTimer) return;
    escapeHoldTimer = setTimeout(() => {
      location.href = '/admin';
    }, ESCAPE_HOLD_MS);
  });
  document.addEventListener('keyup', (e) => {
    if (e.key !== 'Escape') return;
    clearTimeout(escapeHoldTimer);
    escapeHoldTimer = null;
  });

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Esta pantalla corre sola, sin nadie mirándola — si la primera carga
  // falla (ej. el servidor admin todavía no terminó de arrancar, o un
  // corte de red de un instante justo cuando la TV se prendió), antes se
  // quedaba trabada para siempre: la excepción cortaba antes de llegar a
  // connectWs(), así que ni siquiera la reconexión automática del
  // WebSocket llegaba a entrar en juego. Ahora el WebSocket se conecta
  // igual (no depende de que esto funcione) y la carga de contenido se
  // reintenta sola hasta lograrlo.
  async function init() {
    connectWs();
    for (;;) {
      try {
        await loadContent();
        await loadPlaylist();
        return;
      } catch (err) {
        await sleep(3000);
      }
    }
  }

  init();
})();

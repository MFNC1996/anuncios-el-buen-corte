(() => {
  const SCREEN_ID = 1;
  const TEMPLATE_LABELS = { grid: 'Grilla', lista: 'Lista', destacado: 'Destacado', portada: 'Portada' };
  const ANIMATION_LABELS = { fade: 'Desvanecer', slide: 'Deslizar', zoom: 'Zoom', cortina: 'Cortina' };
  const FIXED_CONTENT_LABELS = {
    portada: 'Portada (bienvenida)',
    horario: 'Horario de atención',
    redes: 'Síguenos en redes',
    qr: 'QR WhatsApp',
  };
  const FIXED_CONTENT_KEYS = Object.keys(FIXED_CONTENT_LABELS);

  const state = {
    categories: [],
    itemsByCategory: {},
    playlistId: null,
    slides: [],
    settings: null,
  };

  const categoriesList = document.getElementById('categories-list');
  const slidesList = document.getElementById('slides-list');
  const toastEl = document.getElementById('toast');

  function showToast(message, isError = false) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    toastEl.style.background = isError ? 'var(--ebc-red)' : 'var(--ebc-ink)';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => (toastEl.hidden = true), 2200);
  }

  async function api(method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Error ${res.status}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }


  // ---------------- Tabs ----------------
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      document.querySelectorAll('.view').forEach((v) => (v.hidden = true));
      document.getElementById(`view-${btn.dataset.tab}`).hidden = false;
      if (btn.dataset.tab === 'tv') checkTizenReadiness();
    });
  });

  // ---------------- Carga de datos ----------------
  async function loadAll() {
    const [categories, items, settings] = await Promise.all([
      api('GET', '/api/categories'),
      api('GET', '/api/items'),
      api('GET', '/api/settings'),
    ]);
    state.categories = categories.sort((a, b) => a.order_index - b.order_index);
    state.itemsByCategory = {};
    items.forEach((item) => {
      if (!state.itemsByCategory[item.category_id]) state.itemsByCategory[item.category_id] = [];
      state.itemsByCategory[item.category_id].push(item);
    });
    Object.values(state.itemsByCategory).forEach((list) => list.sort((a, b) => a.order_index - b.order_index));
    state.settings = settings;

    const screen = await api('GET', `/api/screens/${SCREEN_ID}`);
    state.playlistId = screen.active_playlist_id;
    if (state.playlistId) {
      const playlist = await api('GET', `/api/playlists/${state.playlistId}`);
      state.slides = playlist.slides || [];
    }

    renderCategories();
    renderSlides();
    renderLocal();
  }

  // ---------------- Render: Productos ----------------
  function renderCategories() {
    categoriesList.innerHTML = state.categories.map((cat) => categoryCardHtml(cat)).join('');
  }

  function categoryCardHtml(cat) {
    const items = state.itemsByCategory[cat.id] || [];
    const rows = items
      .map(
        (item) => `
      <tr data-item-id="${item.id}">
        <td>
          <img class="item-thumb" src="${escapeHtml(item.photo_path || '/shared/brand/placeholder.svg')}" alt="" />
          <input type="file" accept="image/png,image/jpeg,image/webp" data-action="upload-photo" data-item-id="${item.id}" hidden />
          <button class="btn-icon" data-action="pick-photo" data-item-id="${item.id}" title="Cambiar foto">📷</button>
        </td>
        <td><input type="text" value="${escapeHtml(item.name)}" data-action="edit-item" data-field="name" data-item-id="${item.id}" /></td>
        <td><input type="number" min="0" value="${item.price}" data-action="edit-item" data-field="price" data-item-id="${item.id}" /></td>
        <td><input type="text" class="unit-input" value="${escapeHtml(item.unit)}" data-action="edit-item" data-field="unit" data-item-id="${item.id}" /></td>
        <td class="row-actions">
          <button class="btn-icon" data-action="move-item-up" data-item-id="${item.id}" data-category-id="${cat.id}">↑</button>
          <button class="btn-icon" data-action="move-item-down" data-item-id="${item.id}" data-category-id="${cat.id}">↓</button>
          <button class="btn-icon danger" data-action="delete-item" data-item-id="${item.id}">🗑</button>
        </td>
      </tr>`
      )
      .join('');

    return `
      <div class="category-card" data-category-id="${cat.id}">
        <div class="category-card__header">
          <input type="text" value="${escapeHtml(cat.name)}" data-action="rename-category" data-category-id="${cat.id}" />
          <button class="btn-icon" data-action="move-category-up" data-category-id="${cat.id}">↑</button>
          <button class="btn-icon" data-action="move-category-down" data-category-id="${cat.id}">↓</button>
          <button class="btn-icon danger" data-action="delete-category" data-category-id="${cat.id}">🗑 Eliminar categoría</button>
        </div>
        <div class="table-scroll">
          <table class="items-table">
            <thead>
              <tr><th>Foto</th><th>Producto</th><th>Precio</th><th>Unidad</th><th></th></tr>
            </thead>
            <tbody>
              ${rows}
              <tr class="add-item-row">
                <td colspan="5">
                  <button class="btn btn-add-item" data-action="add-item" data-category-id="${cat.id}">+ Agregar producto</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>`;
  }

  function reorderIds(list) {
    return list.map((x) => x.id);
  }

  categoriesList.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action } = btn.dataset;

    try {
      if (action === 'add-item') {
        const categoryId = Number(btn.dataset.categoryId);
        await api('POST', '/api/items', { category_id: categoryId, name: 'Nuevo producto', price: 0, unit: 'kg' });
        await loadAll();
      } else if (action === 'delete-item') {
        if (!confirm('¿Eliminar este producto?')) return;
        await api('DELETE', `/api/items/${btn.dataset.itemId}`);
        await loadAll();
      } else if (action === 'delete-category') {
        if (!confirm('¿Eliminar esta categoría y todos sus productos?')) return;
        await api('DELETE', `/api/categories/${btn.dataset.categoryId}`);
        await loadAll();
      } else if (action === 'pick-photo') {
        const input = categoriesList.querySelector(`input[type=file][data-item-id="${btn.dataset.itemId}"]`);
        input.click();
      } else if (action === 'move-category-up' || action === 'move-category-down') {
        moveCategory(Number(btn.dataset.categoryId), action === 'move-category-up' ? -1 : 1);
      } else if (action === 'move-item-up' || action === 'move-item-down') {
        moveItem(Number(btn.dataset.categoryId), Number(btn.dataset.itemId), action === 'move-item-up' ? -1 : 1);
      }
    } catch (err) {
      showToast(err.message, true);
    }
  });

  async function moveCategory(categoryId, direction) {
    const ordered = [...state.categories];
    const index = ordered.findIndex((c) => c.id === categoryId);
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= ordered.length) return;
    [ordered[index], ordered[swapWith]] = [ordered[swapWith], ordered[index]];
    await api('POST', '/api/categories/reorder', { orderedIds: reorderIds(ordered) });
    await loadAll();
  }

  async function moveItem(categoryId, itemId, direction) {
    const ordered = [...(state.itemsByCategory[categoryId] || [])];
    const index = ordered.findIndex((i) => i.id === itemId);
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= ordered.length) return;
    [ordered[index], ordered[swapWith]] = [ordered[swapWith], ordered[index]];
    await api('POST', '/api/items/reorder', { orderedIds: reorderIds(ordered) });
    await loadAll();
  }

  categoriesList.addEventListener('change', async (e) => {
    const target = e.target;
    const { action } = target.dataset;
    try {
      if (action === 'rename-category') {
        await api('PUT', `/api/categories/${target.dataset.categoryId}`, { name: target.value });
        showToast('Categoría actualizada');
      } else if (action === 'edit-item') {
        const field = target.dataset.field;
        const value = field === 'price' ? Number(target.value) : target.value;
        await api('PUT', `/api/items/${target.dataset.itemId}`, { [field]: value });
        showToast('Producto actualizado');
      } else if (action === 'upload-photo') {
        const file = target.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('photo', file);
        const res = await fetch(`/api/uploads/item/${target.dataset.itemId}`, { method: 'POST', body: formData });
        if (!res.ok) throw new Error('No se pudo subir la foto');
        await loadAll();
        showToast('Foto actualizada');
      }
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('form-add-category').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('new-category-name');
    if (!input.value.trim()) return;
    try {
      await api('POST', '/api/categories', { name: input.value.trim() });
      input.value = '';
      await loadAll();
      showToast('Categoría agregada');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // ---------------- Render: Playlist / orden en pantalla ----------------
  function renderSlides() {
    if (!state.playlistId) {
      slidesList.innerHTML = '<p>No hay playlist asignada a la pantalla.</p>';
      return;
    }
    slidesList.innerHTML = state.slides
      .map((slide, index) => slideCardHtml(slide, index))
      .join('');
  }

  function slideCardHtml(slide, index) {
    const isFixedContent = !slide.category_id;
    const contentValue = isFixedContent ? slide.template_key : `cat:${slide.category_id}`;

    const fixedOptions = FIXED_CONTENT_KEYS.map(
      (key) => `<option value="${key}" ${contentValue === key ? 'selected' : ''}>${FIXED_CONTENT_LABELS[key]}</option>`
    ).join('');

    const categoryOptions = state.categories
      .map(
        (cat) =>
          `<option value="cat:${cat.id}" ${slide.category_id === cat.id ? 'selected' : ''}>${escapeHtml(cat.name)}</option>`
      )
      .join('');

    const templateOptions = ['grid', 'lista', 'destacado']
      .map((key) => `<option value="${key}" ${slide.template_key === key ? 'selected' : ''}>${TEMPLATE_LABELS[key]}</option>`)
      .join('');

    const animationOptions = Object.keys(ANIMATION_LABELS)
      .map((key) => `<option value="${key}" ${slide.animation_key === key ? 'selected' : ''}>${ANIMATION_LABELS[key]}</option>`)
      .join('');

    return `
      <div class="slide-card" data-slide-id="${slide.id}">
        <span class="slide-index">${index + 1}</span>

        <label>Contenido
          <select data-action="slide-content" data-slide-id="${slide.id}">
            <optgroup label="Institucional">${fixedOptions}</optgroup>
            <optgroup label="Categorías">${categoryOptions}</optgroup>
          </select>
        </label>

        <label>Plantilla
          <select data-action="slide-template" data-slide-id="${slide.id}" ${isFixedContent ? 'disabled' : ''}>
            ${isFixedContent ? `<option selected>${TEMPLATE_LABELS[slide.template_key] || FIXED_CONTENT_LABELS[slide.template_key]}</option>` : templateOptions}
          </select>
        </label>

        <label>Animación
          <select data-action="slide-animation" data-slide-id="${slide.id}">${animationOptions}</select>
        </label>

        <label>Duración (seg)
          <input type="number" min="2" class="duration-input" value="${slide.duration_seconds}" data-action="slide-duration" data-slide-id="${slide.id}" />
        </label>

        <div class="row-actions">
          <button class="btn-icon" data-action="move-slide-up" data-slide-id="${slide.id}">↑</button>
          <button class="btn-icon" data-action="move-slide-down" data-slide-id="${slide.id}">↓</button>
          <button class="btn-icon danger" data-action="delete-slide" data-slide-id="${slide.id}">🗑</button>
        </div>
      </div>`;
  }

  slidesList.addEventListener('change', async (e) => {
    const target = e.target;
    const { action } = target.dataset;
    const slideId = target.dataset.slideId;
    try {
      if (action === 'slide-content') {
        const isCategory = target.value.startsWith('cat:');
        const categoryId = isCategory ? Number(target.value.slice(4)) : null;
        await api('PUT', `/api/playlists/slides/${slideId}`, {
          category_id: categoryId,
          template_key: isCategory ? 'grid' : target.value,
        });
        await loadAll();
      } else if (action === 'slide-template') {
        await api('PUT', `/api/playlists/slides/${slideId}`, { template_key: target.value });
      } else if (action === 'slide-animation') {
        await api('PUT', `/api/playlists/slides/${slideId}`, { animation_key: target.value });
      } else if (action === 'slide-duration') {
        await api('PUT', `/api/playlists/slides/${slideId}`, { duration_seconds: Number(target.value) });
      }
      showToast('Cartelera actualizada');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  slidesList.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action } = btn.dataset;
    const slideId = Number(btn.dataset.slideId);
    try {
      if (action === 'delete-slide') {
        if (!confirm('¿Eliminar este cartel de la cartelera?')) return;
        await api('DELETE', `/api/playlists/slides/${slideId}`);
        await loadAll();
      } else if (action === 'move-slide-up' || action === 'move-slide-down') {
        const ordered = [...state.slides];
        const index = ordered.findIndex((s) => s.id === slideId);
        const swapWith = index + (action === 'move-slide-up' ? -1 : 1);
        if (swapWith < 0 || swapWith >= ordered.length) return;
        [ordered[index], ordered[swapWith]] = [ordered[swapWith], ordered[index]];
        await api('POST', `/api/playlists/${state.playlistId}/slides/reorder`, { orderedIds: reorderIds(ordered) });
        await loadAll();
      }
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('add-slide').addEventListener('click', async () => {
    try {
      const firstCategory = state.categories[0];
      await api('POST', `/api/playlists/${state.playlistId}/slides`, {
        category_id: firstCategory ? firstCategory.id : null,
        template_key: firstCategory ? 'grid' : 'portada',
        animation_key: 'fade',
        duration_seconds: 8,
      });
      await loadAll();
      showToast('Cartel agregado');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // ---------------- Datos del local ----------------
  const hoursEditor = document.getElementById('hours-editor');
  const localInstagram = document.getElementById('local-instagram');
  const localFacebook = document.getElementById('local-facebook');
  const localWhatsappDisplay = document.getElementById('local-whatsapp-display');
  const localWhatsappUrl = document.getElementById('local-whatsapp-url');
  const backgroundPreview = document.getElementById('background-preview');
  const backgroundFile = document.getElementById('background-file');
  const backgroundUploadBtn = document.getElementById('background-upload-btn');
  const backgroundRemoveBtn = document.getElementById('background-remove-btn');
  const backgroundOpacity = document.getElementById('background-opacity');
  const backgroundOpacityValue = document.getElementById('background-opacity-value');

  function renderLocal() {
    if (!state.settings) return;
    localInstagram.value = state.settings.instagram || '';
    localFacebook.value = state.settings.facebook || '';
    localWhatsappDisplay.value = state.settings.whatsapp_display || '';
    localWhatsappUrl.value = state.settings.whatsapp_group_url || '';

    updateBackgroundPreview(state.settings.background_image_path);
    const opacity = state.settings.background_overlay_opacity ?? 80;
    backgroundOpacity.value = opacity;
    backgroundOpacityValue.textContent = `${opacity}%`;

    const hours = state.settings.hours || [];
    hoursEditor.innerHTML = hours
      .map(
        (h, i) => `
      <div class="hours-row-edit" data-index="${i}">
        <span class="hours-day-label">${escapeHtml(h.day)}</span>
        <input type="time" value="${h.open || ''}" data-field="open" ${h.closed ? 'disabled' : ''} />
        <span>–</span>
        <input type="time" value="${h.close || ''}" data-field="close" ${h.closed ? 'disabled' : ''} />
        <label class="closed-toggle">
          <input type="checkbox" data-field="closed" ${h.closed ? 'checked' : ''} /> Cerrado
        </label>
      </div>`
      )
      .join('');
  }

  hoursEditor.addEventListener('change', (e) => {
    const row = e.target.closest('.hours-row-edit');
    if (!row) return;
    const index = Number(row.dataset.index);
    const h = state.settings.hours[index];
    if (e.target.dataset.field === 'closed') {
      h.closed = e.target.checked;
      row.querySelectorAll('input[type="time"]').forEach((input) => (input.disabled = h.closed));
    } else if (e.target.dataset.field === 'open') {
      h.open = e.target.value;
    } else if (e.target.dataset.field === 'close') {
      h.close = e.target.value;
    }
  });

  backgroundUploadBtn.addEventListener('click', () => backgroundFile.click());

  // Actualiza solo la vista previa del fondo (no llama a renderLocal/GET):
  // así no se pisan cambios sin guardar que el usuario ya haya escrito en
  // los demás campos de este formulario (redes, horario, etc.).
  function updateBackgroundPreview(imagePath) {
    state.settings.background_image_path = imagePath;
    if (imagePath) {
      backgroundPreview.textContent = '';
      backgroundPreview.style.backgroundImage = `url('${imagePath}')`;
      backgroundRemoveBtn.hidden = false;
    } else {
      backgroundPreview.textContent = 'Sin imagen';
      backgroundPreview.style.backgroundImage = '';
      backgroundRemoveBtn.hidden = true;
    }
  }

  backgroundFile.addEventListener('change', async () => {
    const file = backgroundFile.files[0];
    if (!file) return;
    try {
      const formData = new FormData();
      formData.append('photo', file);
      const res = await fetch('/api/uploads/background', { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo subir la imagen');
      updateBackgroundPreview(data.background_image_path);
      showToast('Imagen de fondo actualizada');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      backgroundFile.value = '';
    }
  });

  backgroundRemoveBtn.addEventListener('click', async () => {
    if (!confirm('¿Quitar la imagen de fondo? La cartelera volverá al fondo sólido.')) return;
    try {
      await fetch('/api/uploads/background', { method: 'DELETE' });
      updateBackgroundPreview(null);
      showToast('Imagen de fondo eliminada');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  backgroundOpacity.addEventListener('input', () => {
    backgroundOpacityValue.textContent = `${backgroundOpacity.value}%`;
  });

  document.getElementById('save-local').addEventListener('click', async () => {
    try {
      const updated = await api('PUT', '/api/settings', {
        instagram: localInstagram.value.trim(),
        facebook: localFacebook.value.trim(),
        whatsapp_display: localWhatsappDisplay.value.trim(),
        whatsapp_group_url: localWhatsappUrl.value.trim(),
        hours: state.settings.hours,
        background_overlay_opacity: Number(backgroundOpacity.value),
      });
      state.settings = updated;
      renderLocal();
      showToast('Datos del local guardados');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // ---------------- Vista previa en vivo ----------------
  const previewWidget = document.getElementById('preview-widget');
  const previewToggle = document.getElementById('preview-toggle');

  const storedPreviewState = localStorage.getItem('previewCollapsed');
  // En pantallas chicas, si el usuario nunca lo tocó, parte minimizado para no tapar el contenido.
  const startCollapsed = storedPreviewState ? storedPreviewState === '1' : window.innerWidth < 720;
  if (startCollapsed) {
    previewWidget.classList.add('is-collapsed');
    previewToggle.textContent = '▢';
    previewToggle.title = 'Expandir';
  }

  previewToggle.addEventListener('click', () => {
    const collapsed = previewWidget.classList.toggle('is-collapsed');
    previewToggle.textContent = collapsed ? '▢' : '—';
    previewToggle.title = collapsed ? 'Expandir' : 'Minimizar';
    localStorage.setItem('previewCollapsed', collapsed ? '1' : '0');
  });

  // ---------------- Instalar en TV Samsung (Tizen) ----------------
  const tizenReadinessBody = document.getElementById('tizen-readiness-body');
  const tizenTvIpInput = document.getElementById('tizen-tv-ip');
  const tizenServerIpInput = document.getElementById('tizen-server-ip');
  const tizenDeployBtn = document.getElementById('tizen-deploy');
  const tizenLog = document.getElementById('tizen-log');

  function readinessRow(ok, label) {
    return `<div class="readiness-row"><span class="readiness-dot ${ok ? 'ok' : 'fail'}"></span>${label}</div>`;
  }

  async function checkTizenReadiness() {
    tizenReadinessBody.innerHTML = '<p>Comprobando...</p>';
    try {
      const status = await api('GET', '/api/tizen/check');
      tizenReadinessBody.innerHTML =
        readinessRow(status.tizenOk, 'Herramienta <code>tizen</code> encontrada') +
        readinessRow(status.sdbOk, 'Herramienta <code>sdb</code> encontrada') +
        (status.busy ? readinessRow(false, 'Hay una instalación en curso ahora mismo') : '');
      if (status.serverIp && !tizenServerIpInput.value) {
        tizenServerIpInput.value = status.serverIp;
      }
      if (status.serverIp) {
        const playerUrlCode = document.getElementById('tv-player-url-1');
        if (playerUrlCode) playerUrlCode.textContent = `http://${status.serverIp}:4010/player/1`;
      }
      tizenDeployBtn.disabled = !status.ready || status.busy;
      if (!status.ready) {
        tizenReadinessBody.innerHTML +=
          '<p class="hint" style="margin-top:0.5rem">El SDK de Tizen no está instalado en este servidor. ' +
          'Corre el servidor desde un PC que lo tenga instalado (ver <code>tizen-app/README.md</code>).</p>';
      }
    } catch (err) {
      tizenReadinessBody.innerHTML = `<p>No se pudo comprobar: ${escapeHtml(err.message)}</p>`;
      tizenDeployBtn.disabled = true;
    }
  }

  function appendTizenLog(line) {
    if (tizenLog.textContent === 'Esperando...') tizenLog.textContent = '';
    tizenLog.textContent += `${line}\n`;
    tizenLog.scrollTop = tizenLog.scrollHeight;
  }

  tizenDeployBtn.addEventListener('click', async () => {
    const tvIp = tizenTvIpInput.value.trim();
    const serverIp = tizenServerIpInput.value.trim();
    if (!tvIp || !serverIp) {
      showToast('Completa la IP de la TV y del servidor', true);
      return;
    }
    tizenLog.textContent = '';
    tizenDeployBtn.disabled = true;
    try {
      await api('POST', '/api/tizen/deploy', { tvIp, serverIp });
    } catch (err) {
      showToast(err.message, true);
      tizenDeployBtn.disabled = false;
    }
  });

  function connectAdminWs() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${location.host}/ws`);
    socket.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (err) {
        return;
      }
      if (msg.event === 'tizen:log') {
        appendTizenLog(msg.payload.line);
      } else if (msg.event === 'tizen:done') {
        appendTizenLog(msg.payload.success ? '✅ Instalación completa.' : `❌ Terminó con error (código ${msg.payload.code}).`);
        showToast(msg.payload.success ? 'App instalada en la TV' : 'La instalación falló, revisa el registro', !msg.payload.success);
        checkTizenReadiness();
      }
    });
    socket.addEventListener('close', () => setTimeout(connectAdminWs, 3000));
    socket.addEventListener('error', () => socket.close());
  }
  connectAdminWs();

  loadAll().catch((err) => showToast(err.message, true));
})();

(() => {
  const SCREEN_ID = 1;
  const TEMPLATE_LABELS = { grid: 'Grilla', lista: 'Lista', destacado: 'Destacado', portada: 'Portada' };
  const ANIMATION_LABELS = { fade: 'Desvanecer', slide: 'Deslizar', zoom: 'Zoom', cortina: 'Cortina' };
  const FIXED_CONTENT_LABELS = {
    portada: 'Portada (bienvenida)',
    horario: 'Horario de atención',
    redes: 'Síguenos en redes',
    qr: 'QR WhatsApp',
    imagen: 'Imagen personalizada',
  };
  const FIXED_CONTENT_KEYS = Object.keys(FIXED_CONTENT_LABELS);

  const state = {
    categories: [],
    itemsByCategory: {},
    playlistId: null,
    slides: [],
    settings: null,
    selectedScreenId: SCREEN_ID,
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

  // Cuadros propios en vez de confirm()/prompt() del navegador: esos
  // dialogos nativos no funcionan en algunos contextos (ej. una ventana
  // abierta en modo "app" de Chrome/Edge, como la que usa el acceso directo
  // del Escritorio) — ahí prompt() directamente no hace nada.
  function showModal({ message, withInput = false, defaultValue = '', confirmLabel = 'Aceptar', danger = false }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'ebc-modal-overlay';
      overlay.innerHTML = `
        <div class="ebc-modal">
          <p class="ebc-modal__message"></p>
          ${withInput ? '<input type="text" class="ebc-modal__input" />' : ''}
          <div class="ebc-modal__actions">
            <button type="button" class="btn-outline" data-action="cancel">Cancelar</button>
            <button type="button" class="btn btn-primary${danger ? ' danger' : ''}" data-action="confirm"></button>
          </div>
        </div>`;
      overlay.querySelector('.ebc-modal__message').textContent = message;
      overlay.querySelector('[data-action="confirm"]').textContent = confirmLabel;
      document.body.appendChild(overlay);

      const input = overlay.querySelector('.ebc-modal__input');
      if (input) {
        input.value = defaultValue;
        input.focus();
        input.select();
      }

      function close(result) {
        overlay.remove();
        resolve(result);
      }
      overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => close(withInput ? null : false));
      overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => {
        close(withInput ? input.value.trim() || null : true);
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(withInput ? null : false);
      });
      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close(withInput ? null : false);
        if (e.key === 'Enter' && input) close(input.value.trim() || null);
      });
    });
  }

  function showConfirm(message, { confirmLabel = 'Eliminar', danger = true } = {}) {
    return showModal({ message, confirmLabel, danger });
  }

  function showPrompt(message, defaultValue = '') {
    return showModal({ message, withInput: true, defaultValue, confirmLabel: 'Guardar' });
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
      if (btn.dataset.tab === 'tv') {
        populateScreenSelects();
        checkTizenReadiness();
        checkAndroidReadiness();
      } else if (btn.dataset.tab === 'pantallas') {
        loadProfiles();
      }
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

    const screen = await api('GET', `/api/screens/${state.selectedScreenId}`);
    state.playlistId = screen.active_playlist_id;
    state.slides = [];
    if (state.playlistId) {
      const playlist = await api('GET', `/api/playlists/${state.playlistId}`);
      state.slides = playlist.slides || [];
    }

    const liveLink = document.getElementById('live-player-link');
    if (liveLink) liveLink.href = `/player/${state.selectedScreenId}`;
    const playlistHint = document.getElementById('playlist-editing-hint');
    if (playlistHint) playlistHint.textContent = screen.name ? `Editando: ${screen.name}` : '';

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
        if (!(await showConfirm('¿Eliminar este producto?'))) return;
        await api('DELETE', `/api/items/${btn.dataset.itemId}`);
        await loadAll();
      } else if (action === 'delete-category') {
        if (!(await showConfirm('¿Eliminar esta categoría y todos sus productos?'))) return;
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

        ${
          slide.template_key === 'imagen'
            ? `<label class="slide-photo-field">Imagen (${slide.photo_path ? 'ya tiene una' : 'sin subir'})
                <input type="file" accept="image/png,image/jpeg,image/webp" data-action="slide-photo" data-slide-id="${slide.id}" />
              </label>`
            : ''
        }

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
      } else if (action === 'slide-photo') {
        const file = target.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('photo', file);
        const res = await fetch(`/api/uploads/slide/${slideId}`, { method: 'POST', body: formData });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo subir la imagen');
        await loadAll();
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
        if (!(await showConfirm('¿Eliminar este cartel de la cartelera?'))) return;
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

  // ---------------- Pantallas (perfiles, mosaico, arrastrar y acomodar) ----------------
  const profilesList = document.getElementById('profiles-list');
  const MODE_LABELS = { independent: 'Independiente', mosaic: 'Mosaico (una imagen repartida)' };
  let profilesState = [];

  async function loadProfiles() {
    try {
      profilesState = await api('GET', '/api/profiles');
      renderProfiles();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function screenBoxHtml(screen, mode) {
    const left = (screen.position_col ?? 0) * 96;
    const top = (screen.position_row ?? 0) * 96;
    return `
      <div class="screen-box" draggable="true" data-screen-id="${screen.id}" style="left:${left}px; top:${top}px;">
        <div class="screen-box__name" title="${escapeHtml(screen.name)}">${escapeHtml(screen.name)}</div>
        <div class="screen-box__url">/player/${screen.id}</div>
        <div class="screen-box__actions">
          ${
            mode === 'independent'
              ? `<button type="button" data-action="edit-screen-playlist" data-screen-id="${screen.id}">Editar cola</button>`
              : ''
          }
          <button type="button" class="danger" data-action="delete-screen" data-screen-id="${screen.id}">Eliminar</button>
        </div>
      </div>`;
  }

  function profileCardHtml(profile) {
    const screensHtml = (profile.screens || []).map((s) => screenBoxHtml(s, profile.mode)).join('');
    const modeOptions = Object.keys(MODE_LABELS)
      .map((key) => `<option value="${key}" ${profile.mode === key ? 'selected' : ''}>${MODE_LABELS[key]}</option>`)
      .join('');

    const mosaicUpload =
      profile.mode === 'mosaic'
        ? `<div class="category-card">
            <div class="category-card__header"><strong>Imagen del mosaico</strong></div>
            <div class="background-preview" style="${
              profile.mosaic_image_path ? `background-image:url('${profile.mosaic_image_path}')` : ''
            }">${profile.mosaic_image_path ? '' : 'Sin imagen'}</div>
            <input type="file" accept="image/png,image/jpeg,image/webp" data-action="upload-mosaic" data-profile-id="${profile.id}" />
          </div>`
        : '';

    return `
      <div class="category-card profile-card" data-profile-id="${profile.id}">
        <div class="category-card__header profile-card__header">
          <input type="text" class="profile-name-input" value="${escapeHtml(profile.name)}" data-action="profile-rename" data-profile-id="${profile.id}" />
          <select data-action="profile-mode" data-profile-id="${profile.id}">${modeOptions}</select>
          <button type="button" class="btn-icon danger" data-action="delete-profile" data-profile-id="${profile.id}">🗑 Eliminar perfil</button>
        </div>
        ${mosaicUpload}
        <div class="screens-canvas" data-profile-id="${profile.id}">${screensHtml}</div>
        <button type="button" class="btn-icon" data-action="add-screen" data-profile-id="${profile.id}">+ Nueva pantalla</button>
      </div>`;
  }

  function wireScreenDragAndDrop() {
    document.querySelectorAll('.screen-box').forEach((box) => {
      box.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', box.dataset.screenId);
      });
    });
    document.querySelectorAll('.screens-canvas').forEach((canvas) => {
      canvas.addEventListener('dragover', (e) => e.preventDefault());
      canvas.addEventListener('drop', async (e) => {
        e.preventDefault();
        const screenId = e.dataTransfer.getData('text/plain');
        if (!screenId) return;
        const rect = canvas.getBoundingClientRect();
        const cellSize = 96;
        const col = Math.max(0, Math.round((e.clientX - rect.left - 40) / cellSize));
        const row = Math.max(0, Math.round((e.clientY - rect.top - 40) / cellSize));
        try {
          await api('PUT', `/api/screens/${screenId}`, { position_row: row, position_col: col });
          await loadProfiles();
        } catch (err) {
          showToast(err.message, true);
        }
      });
    });
  }

  function renderProfiles() {
    profilesList.innerHTML = profilesState.map(profileCardHtml).join('');
    wireScreenDragAndDrop();
  }

  profilesList.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action } = btn.dataset;
    try {
      if (action === 'delete-profile') {
        if (!(await showConfirm('¿Eliminar este perfil? (tiene que no tener pantallas asignadas)'))) return;
        await api('DELETE', `/api/profiles/${btn.dataset.profileId}`);
        await loadProfiles();
      } else if (action === 'add-screen') {
        const name = await showPrompt('Nombre de la nueva pantalla (ej. "TV Caja 2"):');
        if (!name || !name.trim()) return;
        await api('POST', '/api/screens', { name: name.trim(), profile_id: Number(btn.dataset.profileId) });
        await loadProfiles();
        await populateScreenSelects();
      } else if (action === 'delete-screen') {
        if (!(await showConfirm('¿Eliminar esta pantalla? Se borra también su cola de carteles.'))) return;
        await api('DELETE', `/api/screens/${btn.dataset.screenId}`);
        await loadProfiles();
        await populateScreenSelects();
      } else if (action === 'edit-screen-playlist') {
        state.selectedScreenId = Number(btn.dataset.screenId);
        await loadAll();
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('is-active'));
        document.querySelector('.tab-btn[data-tab="playlist"]').classList.add('is-active');
        document.querySelectorAll('.view').forEach((v) => (v.hidden = true));
        document.getElementById('view-playlist').hidden = false;
        return;
      }
      showToast('Listo');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  profilesList.addEventListener('change', async (e) => {
    const target = e.target;
    const { action } = target.dataset;
    try {
      if (action === 'profile-mode') {
        await api('PUT', `/api/profiles/${target.dataset.profileId}`, { mode: target.value });
        await loadProfiles();
      } else if (action === 'profile-rename') {
        await api('PUT', `/api/profiles/${target.dataset.profileId}`, { name: target.value });
      } else if (action === 'upload-mosaic') {
        const file = target.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('photo', file);
        const res = await fetch(`/api/uploads/profile/${target.dataset.profileId}`, { method: 'POST', body: formData });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo subir la imagen');
        await loadProfiles();
      }
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('add-profile').addEventListener('click', async () => {
    const name = await showPrompt('Nombre del nuevo perfil (ej. "Exhibición", "Caja", "Afuera"):');
    if (!name || !name.trim()) return;
    try {
      await api('POST', '/api/profiles', { name: name.trim() });
      await loadProfiles();
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
    if (!(await showConfirm('¿Quitar la imagen de fondo? La cartelera volverá al fondo sólido.'))) return;
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

  // ---------------- QR de acceso desde el celular ----------------
  const qrWidget = document.getElementById('qr-widget');
  const qrToggle = document.getElementById('qr-toggle');
  const qrWidgetImg = document.getElementById('qr-widget-img');
  const qrWidgetUrl = document.getElementById('qr-widget-url');

  const storedQrState = localStorage.getItem('qrWidgetCollapsed');
  const qrStartCollapsed = storedQrState ? storedQrState === '1' : window.innerWidth < 720;
  if (qrStartCollapsed) {
    qrWidget.classList.add('is-collapsed');
    qrToggle.textContent = '▢';
    qrToggle.title = 'Expandir';
  }

  qrToggle.addEventListener('click', () => {
    const collapsed = qrWidget.classList.toggle('is-collapsed');
    qrToggle.textContent = collapsed ? '▢' : '—';
    qrToggle.title = collapsed ? 'Expandir' : 'Minimizar';
    localStorage.setItem('qrWidgetCollapsed', collapsed ? '1' : '0');
  });

  api('GET', '/api/server-info')
    .then((info) => {
      if (info.qrDataUrl) {
        qrWidgetImg.src = info.qrDataUrl;
        qrWidgetUrl.textContent = info.adminUrl;
      } else {
        qrWidgetUrl.textContent = 'No se detectó la IP de este PC en la red.';
      }
    })
    .catch(() => {
      qrWidgetUrl.textContent = 'No se pudo generar el QR.';
    });

  // ---------------- Instalar en TV Samsung (Tizen) ----------------
  const tizenReadinessBody = document.getElementById('tizen-readiness-body');
  const tizenInstallSdkBtn = document.getElementById('tizen-install-sdk');
  const tizenScreenSelect = document.getElementById('tizen-screen-select');
  const tizenTvIpInput = document.getElementById('tizen-tv-ip');
  const tizenServerIpInput = document.getElementById('tizen-server-ip');
  const tizenDeployBtn = document.getElementById('tizen-deploy');
  const tizenScanBtn = document.getElementById('tizen-scan');
  const tizenScanResults = document.getElementById('tizen-scan-results');
  const tizenLog = document.getElementById('tizen-log');
  const tizenSpinner = document.getElementById('tizen-spinner');

  // Spinner junto a "Progreso": se prende apenas se aprieta un botón y se
  // apaga cuando llega el evento "...:done" (éxito o error) — así siempre
  // queda claro si algo sigue corriendo, incluso si el registro de texto
  // tarda en mostrar la próxima línea (ej. mientras espera una respuesta
  // por red que no imprime nada hasta que termina).
  function setSpinner(el, busy) {
    if (el) el.hidden = !busy;
  }

  function readinessRow(ok, label) {
    return `<div class="readiness-row"><span class="readiness-dot ${ok ? 'ok' : 'fail'}"></span>${label}</div>`;
  }

  const BUSY_LABELS = {
    'tizen-deploy': 'instalando en una TV Samsung',
    'tizen-install-sdk': 'instalando el SDK de Tizen',
    'android-deploy': 'abriendo la cartelera en una TV Android',
    'android-open-store': 'abriendo la Play Store en una TV',
    'android-install-apk': 'instalando un .apk en una TV',
    'update-apply': 'actualizando el software',
  };

  function busyMessage(busyWith) {
    const what = BUSY_LABELS[busyWith] || 'otra operación';
    return `Ya hay algo en curso ahora mismo: ${what}. Espera a que termine.`;
  }

  async function checkTizenReadiness() {
    tizenReadinessBody.innerHTML = '<p>Comprobando...</p>';
    tizenInstallSdkBtn.hidden = true;
    try {
      const status = await api('GET', '/api/tizen/check');
      tizenReadinessBody.innerHTML =
        readinessRow(status.tizenOk, 'Herramienta <code>tizen</code> encontrada') +
        readinessRow(status.sdbOk, 'Herramienta <code>sdb</code> encontrada') +
        (status.busy ? readinessRow(false, busyMessage(status.busyWith)) : '');
      if (status.serverIp && !tizenServerIpInput.value) {
        tizenServerIpInput.value = status.serverIp;
      }
      if (status.serverIp) {
        const playerUrlCode = document.getElementById('tv-player-url-1');
        if (playerUrlCode) playerUrlCode.textContent = `http://${status.serverIp}:4010/player/1`;
      }
      tizenDeployBtn.disabled = !status.ready || status.busy;
      if (!status.ready) {
        if (status.canAutoInstallSdk) {
          tizenInstallSdkBtn.hidden = false;
          tizenInstallSdkBtn.disabled = status.busy;
        } else {
          tizenReadinessBody.innerHTML +=
            '<p class="hint" style="margin-top:0.5rem">El SDK de Tizen no está instalado en este PC ' +
            '(y la instalación automática solo está disponible en Windows). Ver ' +
            '<code>tizen-app/README.md</code>.</p>';
        }
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

  tizenInstallSdkBtn.addEventListener('click', async () => {
    tizenLog.textContent = '';
    tizenInstallSdkBtn.disabled = true;
    tizenDeployBtn.disabled = true;
    setSpinner(tizenSpinner, true);
    try {
      await api('POST', '/api/tizen/install-sdk');
    } catch (err) {
      showToast(err.message, true);
      tizenInstallSdkBtn.disabled = false;
      tizenDeployBtn.disabled = false;
      setSpinner(tizenSpinner, false);
    }
  });

  tizenDeployBtn.addEventListener('click', async () => {
    const tvIp = tizenTvIpInput.value.trim();
    const serverIp = tizenServerIpInput.value.trim();
    if (!tvIp || !serverIp) {
      showToast('Completa la IP de la TV y del servidor', true);
      return;
    }
    tizenLog.textContent = '';
    tizenDeployBtn.disabled = true;
    setSpinner(tizenSpinner, true);
    try {
      await api('POST', '/api/tizen/deploy', { tvIp, serverIp, screenId: Number(tizenScreenSelect.value) || 1 });
    } catch (err) {
      setSpinner(tizenSpinner, false);
      showToast(err.message, true);
      tizenDeployBtn.disabled = false;
    }
  });

  function renderScanResults(container, devices, onPick) {
    if (!devices.length) {
      container.innerHTML = '<p class="hint">No se encontró ninguna TV en la red. Escribe la IP a mano.</p>';
      return;
    }
    const labels = { samsung: 'Samsung (Tizen)', android: 'Android/Google TV/Fire TV' };
    container.innerHTML = devices
      .map((d) => `<button type="button" class="btn-icon" data-ip="${d.ip}">📺 ${d.ip} — ${labels[d.type] || d.type}</button>`)
      .join(' ');
    container.querySelectorAll('button[data-ip]').forEach((btn) => {
      btn.addEventListener('click', () => onPick(btn.dataset.ip));
    });
  }

  tizenScanBtn.addEventListener('click', async () => {
    tizenScanBtn.disabled = true;
    tizenScanResults.innerHTML = '<p class="hint">Buscando en la red (puede tardar unos segundos)...</p>';
    try {
      const { devices } = await api('GET', '/api/network/scan');
      renderScanResults(tizenScanResults, devices, (ip) => {
        tizenTvIpInput.value = ip;
      });
    } catch (err) {
      tizenScanResults.innerHTML = `<p class="hint">No se pudo buscar: ${escapeHtml(err.message)}</p>`;
    } finally {
      tizenScanBtn.disabled = false;
    }
  });

  // ---------------- Instalar en TV Android / Google TV / Fire TV Stick ----------------
  const androidReadinessBody = document.getElementById('android-readiness-body');
  const androidScreenSelect = document.getElementById('android-screen-select');
  const androidTvIpInput = document.getElementById('android-tv-ip');
  const androidDeployBtn = document.getElementById('android-deploy');
  const androidOpenStoreBtn = document.getElementById('android-open-store');
  const androidScanBtn = document.getElementById('android-scan');
  const androidScanResults = document.getElementById('android-scan-results');
  const androidApkFile = document.getElementById('android-apk-file');
  const androidInstallApkBtn = document.getElementById('android-install-apk');
  const androidLog = document.getElementById('android-log');
  const androidSpinner = document.getElementById('android-spinner');
  let androidServerIp = '';

  async function populateScreenSelects() {
    try {
      const screens = await api('GET', '/api/screens');
      const options = screens
        .map((s) => `<option value="${s.id}">${escapeHtml(s.name)} (pantalla ${s.id})</option>`)
        .join('');
      [tizenScreenSelect, androidScreenSelect].forEach((select) => {
        const previous = select.value;
        select.innerHTML = options;
        if (screens.some((s) => String(s.id) === previous)) select.value = previous;
      });
    } catch (err) {
      // si falla, se queda vacio — los deploys igual funcionan asumiendo pantalla 1 si no se eligio nada
    }
  }

  function appendAndroidLog(line) {
    if (androidLog.textContent === 'Esperando...') androidLog.textContent = '';
    androidLog.textContent += `${line}\n`;
    androidLog.scrollTop = androidLog.scrollHeight;
  }

  function setAndroidBusy(busy) {
    [androidDeployBtn, androidOpenStoreBtn, androidInstallApkBtn].forEach((b) => (b.disabled = busy));
  }

  async function checkAndroidReadiness() {
    androidReadinessBody.innerHTML = '<p>Comprobando...</p>';
    try {
      const status = await api('GET', '/api/android/check');
      androidServerIp = status.serverIp || '';
      androidReadinessBody.innerHTML =
        readinessRow(status.ready, 'Herramienta <code>adb</code> encontrada') +
        (status.busy ? readinessRow(false, 'Hay una operación en curso ahora mismo') : '');
      setAndroidBusy(!status.ready || status.busy);
    } catch (err) {
      androidReadinessBody.innerHTML = `<p>No se pudo comprobar: ${escapeHtml(err.message)}</p>`;
      setAndroidBusy(true);
    }
  }

  androidScanBtn.addEventListener('click', async () => {
    androidScanBtn.disabled = true;
    androidScanResults.innerHTML = '<p class="hint">Buscando en la red (puede tardar unos segundos)...</p>';
    try {
      const { devices } = await api('GET', '/api/network/scan');
      renderScanResults(androidScanResults, devices, (ip) => {
        androidTvIpInput.value = ip;
      });
    } catch (err) {
      androidScanResults.innerHTML = `<p class="hint">No se pudo buscar: ${escapeHtml(err.message)}</p>`;
    } finally {
      androidScanBtn.disabled = false;
    }
  });

  androidDeployBtn.addEventListener('click', async () => {
    const tvIp = androidTvIpInput.value.trim();
    if (!tvIp) {
      showToast('Completa la IP de la TV', true);
      return;
    }
    androidLog.textContent = '';
    setAndroidBusy(true);
    setSpinner(androidSpinner, true);
    try {
      await api('POST', '/api/android/deploy', {
        tvIp,
        serverIp: androidServerIp,
        screenId: Number(androidScreenSelect.value) || 1,
      });
    } catch (err) {
      showToast(err.message, true);
      setAndroidBusy(false);
      setSpinner(androidSpinner, false);
    }
  });

  androidOpenStoreBtn.addEventListener('click', async () => {
    const tvIp = androidTvIpInput.value.trim();
    if (!tvIp) {
      showToast('Completa la IP de la TV', true);
      return;
    }
    androidLog.textContent = '';
    setAndroidBusy(true);
    setSpinner(androidSpinner, true);
    try {
      await api('POST', '/api/android/open-play-store', { tvIp });
    } catch (err) {
      showToast(err.message, true);
      setAndroidBusy(false);
      setSpinner(androidSpinner, false);
    }
  });

  androidInstallApkBtn.addEventListener('click', async () => {
    const tvIp = androidTvIpInput.value.trim();
    const file = androidApkFile.files[0];
    if (!tvIp) {
      showToast('Completa la IP de la TV', true);
      return;
    }
    if (!file) {
      showToast('Elige un archivo .apk', true);
      return;
    }
    androidLog.textContent = '';
    setAndroidBusy(true);
    setSpinner(androidSpinner, true);
    const formData = new FormData();
    formData.append('apk', file);
    formData.append('tvIp', tvIp);
    try {
      const res = await fetch('/api/android/install-apk', { method: 'POST', body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Error ${res.status}`);
      }
    } catch (err) {
      showToast(err.message, true);
      setAndroidBusy(false);
      setSpinner(androidSpinner, false);
    }
  });

  // ---------------- Actualizaciones de software ----------------
  const updateCurrentVersion = document.getElementById('update-current-version');
  const updateStatus = document.getElementById('update-status');
  const updateCheckBtn = document.getElementById('update-check');
  const updateApplyBtn = document.getElementById('update-apply');
  const updateLog = document.getElementById('update-log');
  const updateSpinner = document.getElementById('update-spinner');

  function appendUpdateLog(line) {
    if (updateLog.textContent === 'Esperando...') updateLog.textContent = '';
    updateLog.textContent += `${line}\n`;
    updateLog.scrollTop = updateLog.scrollHeight;
  }

  async function checkForUpdate() {
    updateCheckBtn.disabled = true;
    updateStatus.textContent = 'Buscando...';
    try {
      const res = await fetch('/api/update/check');
      const status = await res.json();
      if (status.currentVersion) updateCurrentVersion.textContent = status.currentVersion;
      if (!res.ok) throw new Error(status.error || `Error ${res.status}`);
      if (status.updateAvailable) {
        updateStatus.textContent = `Hay una versión nueva disponible: ${status.latestVersion}`;
        updateApplyBtn.hidden = false;
        updateApplyBtn.disabled = status.busy;
      } else {
        updateStatus.textContent = 'Ya tienes la última versión.';
        updateApplyBtn.hidden = true;
      }
    } catch (err) {
      updateStatus.textContent = `No se pudo buscar actualizaciones: ${err.message}`;
    } finally {
      updateCheckBtn.disabled = false;
    }
  }

  updateCheckBtn.addEventListener('click', checkForUpdate);

  updateApplyBtn.addEventListener('click', async () => {
    updateApplyBtn.disabled = true;
    updateCheckBtn.disabled = true;
    updateLog.textContent = '';
    setSpinner(updateSpinner, true);
    appendUpdateLog('Iniciando actualización. No cierres esta ventana ni apagues el PC...');
    try {
      await api('POST', '/api/update/apply');
    } catch (err) {
      showToast(err.message, true);
      updateApplyBtn.disabled = false;
      updateCheckBtn.disabled = false;
      setSpinner(updateSpinner, false);
    }
  });

  checkForUpdate();

  function waitForServerAndReload(attemptsLeft = 30) {
    setTimeout(async () => {
      try {
        const res = await fetch('/api/update/check');
        if (res.ok) {
          location.reload();
          return;
        }
      } catch (err) {
        // el servidor todavia esta reiniciando
      }
      if (attemptsLeft > 0) waitForServerAndReload(attemptsLeft - 1);
      else location.reload();
    }, 1000);
  }

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
        setSpinner(tizenSpinner, false);
        appendTizenLog(msg.payload.success ? '✅ Instalación completa.' : `❌ ${msg.payload.error || 'Terminó con error.'}`);
        showToast(msg.payload.success ? 'App instalada en la TV' : msg.payload.error || 'La instalación falló, revisa el registro', !msg.payload.success);
        checkTizenReadiness();
      } else if (msg.event === 'update:log') {
        appendUpdateLog(msg.payload.line);
      } else if (msg.event === 'update:done') {
        if (msg.payload.success) {
          appendUpdateLog('✅ Actualización completa. Reiniciando y recargando esta página...');
          waitForServerAndReload();
        } else {
          setSpinner(updateSpinner, false);
          appendUpdateLog(`❌ ${msg.payload.error || 'La actualización falló.'}`);
          showToast(msg.payload.error || 'La actualización falló, revisa el registro', true);
          updateApplyBtn.disabled = false;
          updateCheckBtn.disabled = false;
        }
      } else if (msg.event === 'tizensdk:log') {
        appendTizenLog(msg.payload.line);
      } else if (msg.event === 'tizensdk:done') {
        setSpinner(tizenSpinner, false);
        appendTizenLog(msg.payload.success ? '✅ SDK instalado.' : `❌ ${msg.payload.error || 'La instalación del SDK falló.'}`);
        showToast(msg.payload.success ? 'SDK de Tizen instalado' : msg.payload.error || 'Falló la instalación del SDK, revisa el registro', !msg.payload.success);
        checkTizenReadiness();
      } else if (msg.event === 'android:log') {
        appendAndroidLog(msg.payload.line);
      } else if (msg.event === 'android:done') {
        setSpinner(androidSpinner, false);
        appendAndroidLog(msg.payload.success ? '✅ Listo.' : `❌ ${msg.payload.error || 'Terminó con error.'}`);
        showToast(msg.payload.success ? 'Listo' : msg.payload.error || 'Falló, revisa el registro', !msg.payload.success);
        setAndroidBusy(false);
        checkAndroidReadiness();
      }
    });
    socket.addEventListener('close', () => setTimeout(connectAdminWs, 3000));
    socket.addEventListener('error', () => socket.close());
  }
  connectAdminWs();

  loadAll().catch((err) => showToast(err.message, true));
})();

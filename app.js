/* ═══════════════════════════════════════
   CUTIEROVER — PART 3.1: JS CONFIG + API + RENDER
   ═══════════════════════════════════════ */

// ─── CONFIG ───
const CONFIG = {
  SUPABASE_URL: 'https://xlthawdoooosskuluumy.supabase.co',
  SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhsdGhhd2Rvb29vc3NrdWx1dW15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNTgxNDcsImV4cCI6MjA5NDgzNDE0N30.qKR9VApdkJfQxJliRJVE4p8bvIrvDTT06Q4EFvnEtsM',
  STREAMER: 'cutierover',
  KEEP_DAYS: 7
};

// ─── STATE ───
let vods = [];
let currentFilter = 'all';
let currentSort = 'newest';
let searchQuery = '';
let visibleCount = 3;
let isAdmin = false;
let supabaseSession = null;
// ─── SUPABASE CLIENT ───
let supabase = null;

function initSupabase() {
  if (typeof createClient !== 'undefined') {
    supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
    console.log('[CutieRover] Supabase initialized');
  } else {
    console.warn('[CutieRover] Supabase client not loaded, retrying in 1s...');
    setTimeout(initSupabase, 1000);
  }
}

// ─── AUTH ───
async function signInWithTwitch() {
  if (!supabase) return;
  
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'twitch',
    options: {
      redirectTo: window.location.origin,
      scopes: 'user:read:email'
    }
  });
  
  if (error) {
    showToast('Ошибка входа: ' + error.message, 'error');
    return;
  }
  
  if (data?.url) {
    window.location.href = data.url;
  }
}

async function signOut() {
  if (!supabase) return;
  
  await supabase.auth.signOut();
  supabaseSession = null;
  isAdmin = false;
  updateAuthUI();
  showToast('Вы вышли из аккаунта', 'info');
}

async function checkSession() {
  if (!supabase) return;
  
  const { data: { session } } = await supabase.auth.getSession();
  supabaseSession = session;
  
  if (session) {
    // Проверяем, является ли пользователь стримером (админом)
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single();
    
    isAdmin = profile?.role === 'admin' || 
              session.user.email?.includes(CONFIG.STREAMER);
  }
  
  updateAuthUI();
}

function updateAuthUI() {
  const authBtn = document.getElementById('auth-btn');
  const adminPanel = document.getElementById('admin-panel');
  
  if (!authBtn) return;
  
  if (supabaseSession) {
    authBtn.innerHTML = `
      <img src="${supabaseSession.user.user_metadata?.avatar_url || '/assets/default-avatar.png'}" 
           alt="avatar" class="auth-avatar">
      <span>${supabaseSession.user.user_metadata?.name || 'Пользователь'}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 18l6-6-6-6"/>
      </svg>
    `;
    authBtn.onclick = toggleUserMenu;
    
    if (adminPanel) {
      adminPanel.style.display = isAdmin ? 'flex' : 'none';
    }
  } else {
    authBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/>
        <polyline points="10 17 15 12 10 7"/>
        <line x1="15" y1="12" x2="3" y2="12"/>
      </svg>
      <span>Войти через Twitch</span>
    `;
    authBtn.onclick = signInWithTwitch;
    
    if (adminPanel) adminPanel.style.display = 'none';
  }
}

function toggleUserMenu() {
  const existing = document.querySelector('.user-dropdown');
  if (existing) {
    existing.remove();
    return;
  }
  
  const dropdown = document.createElement('div');
  dropdown.className = 'user-dropdown';
  dropdown.innerHTML = `
    <div class="dropdown-item" onclick="window.open('https://twitch.tv/${CONFIG.STREAMER}', '_blank')">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 2H3v16h5v4l4-4h5l4-4V2zm-5 9V7m-4 4V7"/>
      </svg>
      Перейти на Twitch
    </div>
    <div class="dropdown-item" onclick="signOut()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
        <polyline points="16 17 21 12 16 7"/>
        <line x1="21" y1="12" x2="9" y2="12"/>
      </svg>
      Выйти
    </div>
  `;
  
  const authBtn = document.getElementById('auth-btn');
  authBtn.appendChild(dropdown);
  
  // Закрыть при клике вне меню
  setTimeout(() => {
    document.addEventListener('click', function close(e) {
      if (!dropdown.contains(e.target) && e.target !== authBtn) {
        dropdown.remove();
        document.removeEventListener('click', close);
      }
    });
  }, 10);
}

// ─── VOD API ───
async function fetchVODs() {
  if (!supabase) {
    console.warn('[CutieRover] Supabase not ready');
    return [];
  }
  
  try {
    const { data, error } = await supabase
      .from('vods')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    vods = data || [];
    
    // Очистка старых записей (client-side)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - CONFIG.KEEP_DAYS);
    
    vods = vods.filter(vod => {
      const vodDate = new Date(vod.created_at);
      return vodDate > cutoff || vod.pinned;
    });
    
    return vods;
  } catch (err) {
    console.error('[CutieRover] Error fetching VODs:', err);
    showToast('Ошибка загрузки записей', 'error');
    return [];
  }
}

async function addVOD(vodData) {
  if (!supabase || !isAdmin) {
    showToast('Нет прав для добавления записи', 'error');
    return false;
  }
  
  try {
    const { data, error } = await supabase
      .from('vods')
      .insert([{
        ...vodData,
        created_at: new Date().toISOString(),
        views: 0,
        likes: 0
      }])
      .select()
      .single();
    
    if (error) throw error;
    
    vods.unshift(data);
    renderVODs();
    showToast('Запись добавлена!', 'success');
    return true;
  } catch (err) {
    console.error('[CutieRover] Error adding VOD:', err);
    showToast('Ошибка добавления записи', 'error');
    return false;
  }
}

async function updateVOD(id, updates) {
  if (!supabase || !isAdmin) return false;
  
  try {
    const { error } = await supabase
      .from('vods')
      .update(updates)
      .eq('id', id);
    
    if (error) throw error;
    
    const idx = vods.findIndex(v => v.id === id);
    if (idx !== -1) {
      vods[idx] = { ...vods[idx], ...updates };
      renderVODs();
    }
    
    showToast('Запись обновлена', 'success');
    return true;
  } catch (err) {
    showToast('Ошибка обновления', 'error');
    return false;
  }
}

async function deleteVOD(id) {
  if (!supabase || !isAdmin) return false;
  
  if (!confirm('Удалить эту запись навсегда?')) return false;
  
  try {
    const { error } = await supabase
      .from('vods')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    
    vods = vods.filter(v => v.id !== id);
    renderVODs();
    showToast('Запись удалена', 'info');
    return true;
  } catch (err) {
    showToast('Ошибка удаления', 'error');
    return false;
  }
}

async function incrementViews(id) {
  if (!supabase) return;
  
  // Оптимистичное обновление
  const idx = vods.findIndex(v => v.id === id);
  if (idx !== -1) {
    vods[idx].views = (vods[idx].views || 0) + 1;
    updateVODCard(id);
  }
  
  // Фоновое обновление в БД
  await supabase.rpc('increment_vod_views', { vod_id: id });
}

async function toggleLike(id) {
  if (!supabaseSession) {
    showToast('Войдите, чтобы поставить лайк', 'info');
    return;
  }
  
  const vod = vods.find(v => v.id === id);
  if (!vod) return;
  
  const userId = supabaseSession.user.id;
  const likedBy = vod.liked_by || [];
  const isLiked = likedBy.includes(userId);
  
  const newLikedBy = isLiked 
    ? likedBy.filter(uid => uid !== userId)
    : [...likedBy, userId];
  
  const newLikes = newLikedBy.length;
  
  // Оптимистичное обновление
  vod.likes = newLikes;
  vod.liked_by = newLikedBy;
  updateVODCard(id);
  
  // Фоновое обновление
  await supabase
    .from('vods')
    .update({ likes: newLikes, liked_by: newLikedBy })
    .eq('id', id);
}
// ─── RENDER VODS ───
function renderVODs() {
  const grid = document.getElementById('vod-grid');
  const emptyState = document.getElementById('empty-state');
  if (!grid) return;
  
  let filtered = filterVODs(vods);
  filtered = sortVODs(filtered);
  
  const total = filtered.length;
  const visible = filtered.slice(0, visibleCount);
  
  // Очистка
  grid.innerHTML = '';
  
  if (visible.length === 0) {
    grid.style.display = 'none';
    if (emptyState) {
      emptyState.style.display = 'flex';
      emptyState.innerHTML = getEmptyStateHTML();
    }
    updateLoadMoreButton(0, 0);
    return;
  }
  
  grid.style.display = 'grid';
  if (emptyState) emptyState.style.display = 'none';
  
  // Рендер карточек
  visible.forEach(vod => {
    const card = createVODCard(vod);
    grid.appendChild(card);
  });
  
  // Lazy load для превью
  initLazyLoad();
  
  // Обновляем кнопку "Загрузить ещё"
  updateLoadMoreButton(visible.length, total);
  
  // Обновляем счётчик
  updateCounter(total);
}

function createVODCard(vod) {
  const div = document.createElement('div');
  div.className = 'vod-card';
  div.dataset.id = vod.id;
  
  const isLiked = vod.liked_by?.includes(supabaseSession?.user?.id);
  const duration = formatDuration(vod.duration);
  const date = formatDate(vod.created_at);
  const gameTag = vod.game ? `<span class="vod-game">${escapeHtml(vod.game)}</span>` : '';
  
  div.innerHTML = `
    <div class="vod-thumbnail" onclick="openVODModal('${vod.id}')">
      <img data-src="${vod.thumbnail_url || '/assets/default-thumb.jpg'}" 
           alt="${escapeHtml(vod.title)}" 
           class="lazy-load"
           src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
      <div class="vod-duration">${duration}</div>
      <div class="vod-play-overlay">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="white" stroke="none">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
      </div>
      ${vod.pinned ? '<div class="vod-pin">📌 Закреплено</div>' : ''}
    </div>
    <div class="vod-info">
      <h3 class="vod-title" onclick="openVODModal('${vod.id}')">${escapeHtml(vod.title)}</h3>
      <div class="vod-meta">
        <span class="vod-date">${date}</span>
        <span class="vod-views">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          ${formatNumber(vod.views || 0)}
        </span>
      </div>
      ${gameTag}
      <div class="vod-actions">
        <button class="vod-like ${isLiked ? 'liked' : ''}" 
                onclick="event.stopPropagation(); toggleLike('${vod.id}')"
                title="${isLiked ? 'Убрать лайк' : 'Поставить лайк'}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="${isLiked ? 'currentColor' : 'none'}" 
               stroke="currentColor" stroke-width="2">
            <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
          </svg>
          <span>${vod.likes || 0}</span>
        </button>
        <button class="vod-share" onclick="event.stopPropagation(); shareVOD('${vod.id}')" title="Поделиться">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="18" cy="5" r="3"/>
            <circle cx="6" cy="12" r="3"/>
            <circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
        </button>
        ${isAdmin ? `
          <button class="vod-edit" onclick="event.stopPropagation(); editVOD('${vod.id}')" title="Редактировать">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="vod-delete" onclick="event.stopPropagation(); deleteVOD('${vod.id}')" title="Удалить">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            </svg>
          </button>
        ` : ''}
      </div>
    </div>
  `;
  
  return div;
}

function updateVODCard(id) {
  const card = document.querySelector(`.vod-card[data-id="${id}"]`);
  if (!card) return;
  
  const vod = vods.find(v => v.id === id);
  if (!vod) return;
  
  // Обновляем только изменяемые элементы
  const likeBtn = card.querySelector('.vod-like');
  const viewsEl = card.querySelector('.vod-views');
  
  if (likeBtn) {
    const isLiked = vod.liked_by?.includes(supabaseSession?.user?.id);
    likeBtn.className = `vod-like ${isLiked ? 'liked' : ''}`;
    likeBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="${isLiked ? 'currentColor' : 'none'}" 
           stroke="currentColor" stroke-width="2">
        <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
      </svg>
      <span>${vod.likes || 0}</span>
    `;
  }
  
  if (viewsEl) {
    viewsEl.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
      ${formatNumber(vod.views || 0)}
    `;
  }
}

// ─── FILTERS ───
function filterVODs(list) {
  let result = [...list];
  
  // Текстовый поиск
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    result = result.filter(vod => 
      vod.title?.toLowerCase().includes(q) ||
      vod.game?.toLowerCase().includes(q) ||
      vod.description?.toLowerCase().includes(q)
    );
  }
  
  // Категория/тип
  if (currentFilter !== 'all') {
    switch (currentFilter) {
      case 'pinned':
        result = result.filter(v => v.pinned);
        break;
      case 'streams':
        result = result.filter(v => v.type === 'stream');
        break;
      case 'clips':
        result = result.filter(v => v.type === 'clip');
        break;
      case 'highlights':
        result = result.filter(v => v.type === 'highlight');
        break;
      case 'this-week':
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        result = result.filter(v => new Date(v.created_at) > weekAgo);
        break;
    }
  }
  
  return result;
}

function sortVODs(list) {
  const sorted = [...list];
  
  switch (currentSort) {
    case 'newest':
      sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      break;
    case 'oldest':
      sorted.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      break;
    case 'popular':
      sorted.sort((a, b) => (b.views || 0) - (a.views || 0));
      break;
    case 'liked':
      sorted.sort((a, b) => (b.likes || 0) - (a.likes || 0));
      break;
    case 'longest':
      sorted.sort((a, b) => (b.duration || 0) - (a.duration || 0));
      break;
    case 'shortest':
      sorted.sort((a, b) => (a.duration || 0) - (b.duration || 0));
      break;
  }
  
  // Закреплённые всегда сверху
  sorted.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  
  return sorted;
}

// ─── FILTER UI HANDLERS ───
function setFilter(filter) {
  currentFilter = filter;
  visibleCount = 3; // Сброс при смене фильтра
  
  // Обновляем активную кнопку
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  
  renderVODs();
  updateURLParams();
}

function setSort(sort) {
  currentSort = sort;
  visibleCount = 3;
  
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sort === sort);
  });
  
  renderVODs();
  updateURLParams();
}

function setSearch(query) {
  searchQuery = query;
  visibleCount = 3;
  renderVODs();
  updateURLParams();
}

// ─── INFINITE SCROLL / LOAD MORE ───
function loadMore() {
  visibleCount += 3;
  renderVODs();
}

function updateLoadMoreButton(visible, total) {
  const btn = document.getElementById('load-more-btn');
  const counter = document.getElementById('load-counter');
  
  if (!btn) return;
  
  if (visible >= total) {
    btn.style.display = 'none';
  } else {
    btn.style.display = 'flex';
    btn.innerHTML = `
      <span>Загрузить ещё</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    `;
  }
  
  if (counter) {
    counter.textContent = `Показано ${visible} из ${total}`;
  }
}

function initInfiniteScroll() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        loadMore();
      }
    });
  }, { rootMargin: '200px' });
  
  const sentinel = document.getElementById('scroll-sentinel');
  if (sentinel) observer.observe(sentinel);
}

// ─── LAZY LOAD IMAGES ───
function initLazyLoad() {
  const images = document.querySelectorAll('img.lazy-load');
  
  if ('IntersectionObserver' in window) {
    const imageObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          img.src = img.dataset.src;
          img.classList.remove('lazy-load');
          img.onload = () => img.classList.add('loaded');
          imageObserver.unobserve(img);
        }
      });
    }, { rootMargin: '50px' });
    
    images.forEach(img => imageObserver.observe(img));
  } else {
    // Fallback
    images.forEach(img => {
      img.src = img.dataset.src;
      img.classList.remove('lazy-load');
    });
  }
}

// ─── EMPTY STATE ───
function getEmptyStateHTML() {
  if (searchQuery) {
    return `
      <div class="empty-icon">🔍</div>
      <h3>Ничего не найдено</h3>
      <p>По запросу "${escapeHtml(searchQuery)}" нет записей</p>
      <button class="btn-secondary" onclick="clearSearch()">Очистить поиск</button>
    `;
  }
  
  if (currentFilter !== 'all') {
    return `
      <div class="empty-icon">📭</div>
      <h3>Записей пока нет</h3>
      <p>В этой категории пока нет сохранённых стримов</p>
      <button class="btn-secondary" onclick="setFilter('all')">Показать все</button>
    `;
  }
  
  return `
    <div class="empty-icon">📹</div>
    <h3>Записи появятся скоро</h3>
    <p>Стримы будут автоматически сохраняться после трансляций</p>
    <a href="https://twitch.tv/${CONFIG.STREAMER}" target="_blank" class="btn-primary">
      Смотреть прямой эфир
    </a>
  `;
}

function clearSearch() {
  const input = document.getElementById('search-input');
  if (input) input.value = '';
  setSearch('');
}

function updateCounter(total) {
  const el = document.getElementById('total-counter');
  if (el) {
    el.textContent = `${total} ${pluralize(total, 'запись', 'записи', 'записей')}`;
  }
}

// ─── URL PARAMS (shareable filters) ───
function updateURLParams() {
  const params = new URLSearchParams();
  if (currentFilter !== 'all') params.set('filter', currentFilter);
  if (currentSort !== 'newest') params.set('sort', currentSort);
  if (searchQuery) params.set('search', searchQuery);
  
  const newURL = params.toString() 
    ? `${window.location.pathname}?${params.toString()}`
    : window.location.pathname;
    
  window.history.replaceState({}, '', newURL);
}

function readURLParams() {
  const params = new URLSearchParams(window.location.search);
  const filter = params.get('filter');
  const sort = params.get('sort');
  const search = params.get('search');
  
  if (filter) currentFilter = filter;
  if (sort) currentSort = sort;
  if (search) searchQuery = search;
}
// ─── MODAL PLAYER ───
function openVODModal(id) {
  const vod = vods.find(v => v.id === id);
  if (!vod) return;
  
  // Увеличиваем счётчик просмотров
  incrementViews(id);
  
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'vod-modal';
  modal.innerHTML = `
    <div class="modal-content modal-vod">
      <button class="modal-close" onclick="closeVODModal()">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      
      <div class="modal-player">
        ${vod.video_url ? `
          <video controls autoplay poster="${vod.thumbnail_url || ''}">
            <source src="${vod.video_url}" type="video/mp4">
            Ваш браузер не поддерживает видео.
          </video>
        ` : vod.embed_url ? `
          <iframe src="${vod.embed_url}" 
                  frameborder="0" 
                  allowfullscreen 
                  allow="autoplay; encrypted-media">
          </iframe>
        ` : `
          <div class="player-placeholder">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="2" y="2" width="20" height="20" rx="2.18"/>
              <line x1="7" y1="2" x2="7" y2="22"/>
              <line x1="17" y1="2" x2="17" y2="22"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <line x1="2" y1="7" x2="7" y2="7"/>
              <line x1="2" y1="17" x2="7" y2="17"/>
              <line x1="17" y1="17" x2="22" y2="17"/>
              <line x1="17" y1="7" x2="22" y2="7"/>
            </svg>
            <p>Видео временно недоступно</p>
            <a href="https://twitch.tv/videos/${vod.external_id}" target="_blank" class="btn-primary">
              Открыть на Twitch
            </a>
          </div>
        `}
      </div>
      
      <div class="modal-info">
        <h2>${escapeHtml(vod.title)}</h2>
        <div class="modal-meta">
          <span class="modal-date">${formatDate(vod.created_at)}</span>
          <span class="modal-duration">${formatDuration(vod.duration)}</span>
          <span class="modal-views">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            ${formatNumber(vod.views || 0)}
          </span>
          <span class="modal-likes">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
            </svg>
            ${vod.likes || 0}
          </span>
        </div>
        ${vod.game ? `<span class="modal-game">${escapeHtml(vod.game)}</span>` : ''}
        ${vod.description ? `<p class="modal-desc">${escapeHtml(vod.description)}</p>` : ''}
        
        <div class="modal-actions">
          <button class="btn-primary" onclick="shareVOD('${vod.id}')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="18" cy="5" r="3"/>
              <circle cx="6" cy="12" r="3"/>
              <circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
            Поделиться
          </button>
          <a href="https://twitch.tv/videos/${vod.external_id}" target="_blank" class="btn-secondary">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 2H3v16h5v4l4-4h5l4-4V2zm-5 9V7m-4 4V7"/>
            </svg>
            На Twitch
          </a>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';
  
  // Закрытие по Escape и клику вне
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeVODModal();
  });
  
  document.addEventListener('keydown', handleModalKeydown);
}

function closeVODModal() {
  const modal = document.getElementById('vod-modal');
  if (!modal) return;
  
  // Останавливаем видео
  const video = modal.querySelector('video');
  if (video) {
    video.pause();
    video.src = '';
  }
  
  const iframe = modal.querySelector('iframe');
  if (iframe) {
    iframe.src = '';
  }
  
  modal.remove();
  document.body.style.overflow = '';
  document.removeEventListener('keydown', handleModalKeydown);
}

function handleModalKeydown(e) {
  if (e.key === 'Escape') closeVODModal();
}

// ─── SHARE ───
async function shareVOD(id) {
  const vod = vods.find(v => v.id === id);
  if (!vod) return;
  
  const shareUrl = `${window.location.origin}?vod=${id}`;
  const shareData = {
    title: vod.title,
    text: `Смотри запись стрима ${CONFIG.STREAMER}: ${vod.title}`,
    url: shareUrl
  };
  
  // Используем Web Share API если доступно
  if (navigator.share) {
    try {
      await navigator.share(shareData);
      return;
    } catch (err) {
      // Пользователь отменил — ничего не делаем
      if (err.name === 'AbortError') return;
    }
  }
  
  // Fallback — копируем в буфер
  try {
    await navigator.clipboard.writeText(shareUrl);
    showToast('Ссылка скопирована в буфер обмена!', 'success');
  } catch (err) {
    // Ещё один fallback
    const input = document.createElement('input');
    input.value = shareUrl;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    showToast('Ссылка скопирована!', 'success');
  }
}

// ─── ADMIN PANEL ───
function initAdminPanel() {
  const panel = document.getElementById('admin-panel');
  if (!panel) return;
  
  panel.innerHTML = `
    <div class="admin-header">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
        <path d="M2 17l10 5 10-5"/>
        <path d="M2 12l10 5 10-5"/>
      </svg>
      <span>Панель управления</span>
    </div>
    <div class="admin-actions">
      <button class="admin-btn" onclick="openAddVODModal()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Добавить запись
      </button>
      <button class="admin-btn" onclick="syncWithTwitch()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="23 4 23 10 17 10"/>
          <polyline points="1 20 1 14 7 14"/>
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
        </svg>
        Синхронизировать с Twitch
      </button>
      <button class="admin-btn" onclick="openSettingsModal()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.17 15a1.65 1.65 0 00-1.51-1H2a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.11 9.5a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.17V4a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
        </svg>
        Настройки
      </button>
    </div>
  `;
}

function openAddVODModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'add-vod-modal';
  modal.innerHTML = `
    <div class="modal-content modal-form">
      <button class="modal-close" onclick="closeModal('add-vod-modal')">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      
      <h2>Добавить запись</h2>
      
      <form id="add-vod-form" onsubmit="handleAddVOD(event)">
        <div class="form-group">
          <label for="vod-title">Название *</label>
          <input type="text" id="vod-title" required maxlength="200" placeholder="Название стрима">
        </div>
        
        <div class="form-group">
          <label for="vod-type">Тип</label>
          <select id="vod-type">
            <option value="stream">Стрим</option>
            <option value="clip">Клип</option>
            <option value="highlight">Хайлайт</option>
          </select>
        </div>
        
        <div class="form-group">
          <label for="vod-game">Игра/Категория</label>
          <input type="text" id="vod-game" placeholder="Just Chatting, Minecraft...">
        </div>
        
        <div class="form-group">
          <label for="vod-video">URL видео</label>
          <input type="url" id="vod-video" placeholder="https://...">
        </div>
        
        <div class="form-group">
          <label for="vod-embed">Embed URL (Twitch)</label>
          <input type="url" id="vod-embed" placeholder="https://player.twitch.tv/...">
        </div>
        
        <div class="form-group">
          <label for="vod-thumb">URL превью</label>
          <input type="url" id="vod-thumb" placeholder="https://...">
        </div>
        
        <div class="form-group">
          <label for="vod-duration">Длительность (сек)</label>
          <input type="number" id="vod-duration" min="0" placeholder="3600">
        </div>
        
        <div class="form-group">
          <label for="vod-desc">Описание</label>
          <textarea id="vod-desc" rows="3" placeholder="Краткое описание..."></textarea>
        </div>
        
        <div class="form-group checkbox">
          <label>
            <input type="checkbox" id="vod-pinned">
            <span>Закрепить запись</span>
          </label>
        </div>
        
        <div class="form-actions">
          <button type="button" class="btn-secondary" onclick="closeModal('add-vod-modal')">Отмена</button>
          <button type="submit" class="btn-primary">Добавить</button>
        </div>
      </form>
    </div>
  `;
  
  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';
}

async function handleAddVOD(e) {
  e.preventDefault();
  
  const formData = {
    title: document.getElementById('vod-title').value.trim(),
    type: document.getElementById('vod-type').value,
    game: document.getElementById('vod-game').value.trim() || null,
    video_url: document.getElementById('vod-video').value.trim() || null,
    embed_url: document.getElementById('vod-embed').value.trim() || null,
    thumbnail_url: document.getElementById('vod-thumb').value.trim() || null,
    duration: parseInt(document.getElementById('vod-duration').value) || null,
    description: document.getElementById('vod-desc').value.trim() || null,
    pinned: document.getElementById('vod-pinned').checked,
    external_id: null
  };
  
  const success = await addVOD(formData);
  if (success) {
    closeModal('add-vod-modal');
    document.getElementById('add-vod-form').reset();
  }
}

function editVOD(id) {
  const vod = vods.find(v => v.id === id);
  if (!vod) return;
  
  openAddVODModal();
  
  // Заполняем форму данными
  setTimeout(() => {
    document.getElementById('vod-title').value = vod.title || '';
    document.getElementById('vod-type').value = vod.type || 'stream';
    document.getElementById('vod-game').value = vod.game || '';
    document.getElementById('vod-video').value = vod.video_url || '';
    document.getElementById('vod-embed').value = vod.embed_url || '';
    document.getElementById('vod-thumb').value = vod.thumbnail_url || '';
    document.getElementById('vod-duration').value = vod.duration || '';
    document.getElementById('vod-desc').value = vod.description || '';
    document.getElementById('vod-pinned').checked = vod.pinned || false;
    
    // Меняем обработчик на обновление
    const form = document.getElementById('add-vod-form');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const updates = {
        title: document.getElementById('vod-title').value.trim(),
        type: document.getElementById('vod-type').value,
        game: document.getElementById('vod-game').value.trim() || null,
        video_url: document.getElementById('vod-video').value.trim() || null,
        embed_url: document.getElementById('vod-embed').value.trim() || null,
        thumbnail_url: document.getElementById('vod-thumb').value.trim() || null,
        duration: parseInt(document.getElementById('vod-duration').value) || null,
        description: document.getElementById('vod-desc').value.trim() || null,
        pinned: document.getElementById('vod-pinned').checked
      };
      
      const success = await updateVOD(id, updates);
      if (success) closeModal('add-vod-modal');
    };
  }, 50);
}

async function syncWithTwitch() {
  showToast('Синхронизация с Twitch...', 'info');
  
  try {
    // Здесь можно добавить вызов к Twitch API через edge function
    const { data, error } = await supabase.functions.invoke('sync-twitch-vods', {
      body: { streamer: CONFIG.STREAMER }
    });
    
    if (error) throw error;
    
    await fetchVODs();
    renderVODs();
    showToast(`Синхронизировано ${data?.count || 0} записей`, 'success');
  } catch (err) {
    console.error('[CutieRover] Sync error:', err);
    showToast('Ошибка синхронизации. Проверьте настройки Twitch API.', 'error');
  }
}

function openSettingsModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'settings-modal';
  modal.innerHTML = `
    <div class="modal-content modal-form">
      <button class="modal-close" onclick="closeModal('settings-modal')">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      
      <h2>Настройки сайта</h2>
      
      <div class="settings-section">
        <h3>Отображение</h3>
        <div class="form-group checkbox">
          <label>
            <input type="checkbox" id="setting-dark-mode" ${document.body.classList.contains('dark') ? 'checked' : ''}>
            <span>Тёмная тема</span>
          </label>
        </div>
        <div class="form-group checkbox">
          <label>
            <input type="checkbox" id="setting-autoplay" checked>
            <span>Автовоспроизведение в плеере</span>
          </label>
        </div>
      </div>
      
      <div class="settings-section">
        <h3>Хранение</h3>
        <div class="form-group">
          <label>Хранить записи (дней)</label>
          <input type="number" id="setting-keep-days" value="${CONFIG.KEEP_DAYS}" min="1" max="90">
        </div>
      </div>
      
      <div class="form-actions">
        <button type="button" class="btn-secondary" onclick="closeModal('settings-modal')">Отмена</button>
        <button type="button" class="btn-primary" onclick="saveSettings()">Сохранить</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';
}

function saveSettings() {
  const darkMode = document.getElementById('setting-dark-mode').checked;
  const keepDays = parseInt(document.getElementById('setting-keep-days').value);
  
  if (darkMode) {
    document.body.classList.add('dark');
    localStorage.setItem('theme', 'dark');
  } else {
    document.body.classList.remove('dark');
    localStorage.setItem('theme', 'light');
  }
  
  if (keepDays && keepDays > 0) {
    CONFIG.KEEP_DAYS = keepDays;
    localStorage.setItem('keep_days', keepDays);
  }
  
  closeModal('settings-modal');
  showToast('Настройки сохранены', 'success');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.remove();
    document.body.style.overflow = '';
  }
}

// ─── TOAST NOTIFICATIONS ───
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container') || createToastContainer();
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const icons = {
    success: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };
  
  toast.innerHTML = `
    ${icons[type] || icons.info}
    <span>${escapeHtml(message)}</span>
  `;
  
  container.appendChild(toast);
  
  // Анимация появления
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });
  
  // Автоудаление
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function createToastContainer() {
  const container = document.createElement('div');
  container.id = 'toast-container';
  document.body.appendChild(container);
  return container;
}

// ─── UTILS ───
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0:00';
  
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatDate(isoString) {
  if (!isoString) return '';
  
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'только что';
  if (diffMins < 60) return `${diffMins} ${pluralize(diffMins, 'минуту', 'минуты', 'минут')} назад`;
  if (diffHours < 24) return `${diffHours} ${pluralize(diffHours, 'час', 'часа', 'часов')} назад`;
  if (diffDays < 7) return `${diffDays} ${pluralize(diffDays, 'день', 'дня', 'дней')} назад`;
  
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function pluralize(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

// ─── THEME ───
function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  if (saved === 'dark' || (!saved && prefersDark)) {
    document.body.classList.add('dark');
  }
}

// ─── INIT ───
document.addEventListener('DOMContentLoaded', async () => {
  initSupabase();
  initTheme();
  readURLParams();
  
  // Ждём загрузки Supabase
  await new Promise(resolve => setTimeout(resolve, 500));
  
  await checkSession();
  await fetchVODs();
  renderVODs();
  initAdminPanel();
  initInfiniteScroll();
  
  // Обработчики UI
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    let debounceTimer;
    searchInput.value = searchQuery;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => setSearch(e.target.value), 300);
    });
  }
  
  // Фильтры
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === currentFilter);
    btn.addEventListener('click', () => setFilter(btn.dataset.filter));
  });
  
  // Сортировка
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sort === currentSort);
    btn.addEventListener('click', () => setSort(btn.dataset.sort));
  });
  
  // Кнопка "Загрузить ещё"
  const loadMoreBtn = document.getElementById('load-more-btn');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', loadMore);
  }
  
  console.log('[CutieRover] App initialized');
});

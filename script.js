'use strict';

/* =====================================================
   script.js : 나만의 냉장고 메인 로직
   구성: 1) 상수/상태  2) 저장소  3) 유틸  4) 기한 계산
         5) 목록 화면  6) 입력 폼  7) 레시피 추천  8) 초기화
   ===================================================== */

/* ---------- 1) 상수 / 상태 ---------- */
const SOON_DAYS = 3; // 남은 기간이 이 값 이하이면 '임박'

// 카테고리별 대체 이모지 (사진이 없을 때 표시)
const CATEGORY_EMOJI = {
  '채소': '🥬', '과일': '🍎', '육류': '🥩', '해산물': '🐟',
  '달걀·유제품': '🥚', '가공식품': '🥫', '곡류·면': '🍚',
  '양념·소스': '🧂', '기타': '🍽️'
};
const UNITS = ['개', 'g', 'ml', '팩', '봉지', '캔', '단', '장', '병'];

// 화면 상태를 한곳에 모아 관리
const state = {
  items: [],          // 식재료 목록
  search: '',
  sort: 'expiry',
  status: 'all',
  location: 'all',
  editingId: null,    // 수정 중인 재료 id (null이면 새로 추가)
  photo: ''           // 폼에서 선택한 사진(압축된 dataURL)
};

const $ = (selector) => document.querySelector(selector);

/* ---------- 2) 저장소 (localStorage) ----------
   저장 방식을 바꾸고 싶으면(예: IndexedDB) 이 객체만 교체하면 된다. */
const storage = {
  KEY: 'myFridge.items.v1',

  load() {
    try {
      return JSON.parse(localStorage.getItem(this.KEY)) || [];
    } catch (e) {
      return [];
    }
  },

  // 저장 성공하면 true, 용량 초과 등으로 실패하면 false
  save(items) {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(items));
      return true;
    } catch (e) {
      return false;
    }
  },

  // 현재 사용량 (문자 수 기준, 브라우저 한도는 약 5백만 자)
  usedPercent() {
    const text = localStorage.getItem(this.KEY) || '';
    return Math.min(100, Math.round((text.length / 5000000) * 100));
  }
};

/* ---------- 3) 유틸 함수 ---------- */
// 사용자가 입력한 글자를 화면에 넣기 전에 안전하게 변환 (XSS 방지)
function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function pad(n) { return String(n).padStart(2, '0'); }

function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// 사진을 작게 줄여서 JPEG 문자열(dataURL)로 변환 → 저장 용량 절약
function compressImage(file, maxSize = 300, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        // 긴 변이 maxSize가 되도록 비율 유지하며 축소 (이미 작으면 그대로)
        const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; // 투명 배경(PNG)이 검게 나오지 않도록
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ---------- 4) 기한 계산 ---------- */
// 오늘 기준 남은 일수 (음수면 지난 것)
function getDaysLeft(item) {
  return Math.round((parseDate(item.expiry) - todayStart()) / 86400000);
}

// 상태 판단: safe(안전) / soon(임박) / expired(만료)
function getStatus(item) {
  const days = getDaysLeft(item);
  if (days < 0) return { key: 'expired', days, label: `D+${-days} 지남` };
  if (days === 0) return { key: 'soon', days, label: 'D-day' };
  if (days <= SOON_DAYS) return { key: 'soon', days, label: `D-${days}` };
  return { key: 'safe', days, label: `D-${days}` };
}

/* ---------- 5) 내 냉장고 화면 ---------- */
function getVisibleItems() {
  const q = state.search.trim().toLowerCase();

  let list = state.items.filter((item) => {
    if (q && !item.name.toLowerCase().includes(q)) return false;
    if (state.location !== 'all' && item.location !== state.location) return false;
    if (state.status !== 'all' && getStatus(item).key !== state.status) return false;
    return true;
  });

  // 정렬
  list.sort((a, b) => {
    if (state.sort === 'added') return b.createdAt - a.createdAt;
    if (state.sort === 'name') return a.name.localeCompare(b.name, 'ko');
    return getDaysLeft(a) - getDaysLeft(b); // 기본: 임박순
  });

  // 만료된 재료는 어떤 정렬이든 맨 위에 고정
  const expired = list.filter((i) => getStatus(i).key === 'expired');
  const others = list.filter((i) => getStatus(i).key !== 'expired');
  return [...expired, ...others];
}

function renderSummary() {
  const total = state.items.length;
  const expired = state.items.filter((i) => getStatus(i).key === 'expired').length;
  const soon = state.items.filter((i) => getStatus(i).key === 'soon').length;

  $('#summaryBar').innerHTML = `
    <span class="pill">전체 ${total}개</span>
    <span class="pill soon">임박 ${soon}개</span>
    <span class="pill expired">만료 ${expired}개</span>`;

  // 경고 배너
  const expiredNames = state.items.filter((i) => getStatus(i).key === 'expired').map((i) => esc(i.name));
  const soonNames = state.items.filter((i) => getStatus(i).key === 'soon').map((i) => esc(i.name));
  let html = '';
  if (expired > 0) {
    html += `<div class="banner expired">⚠️ 기한이 지난 재료가 ${expired}개 있어요: ${expiredNames.join(', ')}</div>`;
  }
  if (soon > 0) {
    html += `<div class="banner soon">⏰ 곧 기한이 끝나는 재료가 ${soon}개 있어요: ${soonNames.join(', ')}</div>`;
  }
  $('#warningBanner').innerHTML = html;
}

function itemCardHTML(item) {
  const st = getStatus(item);
  const photo = item.photo
    ? `<img src="${item.photo}" alt="${esc(item.name)}">`
    : `<span class="emoji">${CATEGORY_EMOJI[item.category] || '🍽️'}</span>`;

  return `
    <article class="item-card ${st.key}" data-id="${item.id}">
      <div class="item-photo">${photo}</div>
      <div class="item-info">
        <div class="item-top">
          <h3>${esc(item.name)}</h3>
          <span class="badge ${st.key}">${st.label}</span>
        </div>
        <ul class="item-meta">
          <li>📍 ${esc(item.location)} · ${esc(item.category)}</li>
          <li>🔢 ${item.quantity}${esc(item.unit)}</li>
          <li>📅 ${esc(item.dateType)}기한 ${esc(item.expiry)}</li>
          ${item.memo ? `<li>📝 ${esc(item.memo)}</li>` : ''}
        </ul>
        <div class="item-actions">
          <button data-action="use">사용</button>
          <button data-action="edit">수정</button>
          <button data-action="delete" class="danger">삭제</button>
        </div>
      </div>
    </article>`;
}

function renderItems() {
  const list = getVisibleItems();
  $('#itemList').innerHTML = list.map(itemCardHTML).join('');

  const empty = $('#emptyMsg');
  if (list.length === 0) {
    empty.classList.remove('hidden');
    empty.textContent = state.items.length === 0
      ? '냉장고가 비어 있어요. 오른쪽 아래 + 버튼으로 재료를 추가해 보세요!'
      : '조건에 맞는 재료가 없어요.';
  } else {
    empty.classList.add('hidden');
  }
}

function renderStorageInfo() {
  const percent = storage.usedPercent();
  const el = $('#storageInfo');
  el.textContent = `저장 공간 사용량 약 ${percent}%`;
  el.classList.toggle('danger', percent >= 80);
  if (percent >= 80) el.textContent += ' · 공간이 부족해요. 오래된 재료를 정리해 주세요!';
}

function renderAll() {
  renderSummary();
  renderItems();
  renderStorageInfo();
  renderRecipes();
}

// 재료 목록 저장 후 화면 갱신 (저장 실패 시 변경하지 않음)
function commitItems(newItems) {
  if (!storage.save(newItems)) {
    alert('저장 공간이 부족해서 저장하지 못했어요.\n오래된 재료나 사진을 정리한 뒤 다시 시도해 주세요.');
    return false;
  }
  state.items = newItems;
  renderAll();
  return true;
}

// 카드 안 버튼 처리 (이벤트 위임)
function handleItemAction(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.closest('.item-card').dataset.id;
  const item = state.items.find((i) => i.id === id);
  if (!item) return;

  const action = btn.dataset.action;

  if (action === 'edit') {
    openItemForm(item);
  } else if (action === 'delete') {
    if (confirm(`'${item.name}'을(를) 삭제할까요?`)) {
      commitItems(state.items.filter((i) => i.id !== id));
    }
  } else if (action === 'use') {
    const input = prompt(`'${item.name}'을(를) 얼마나 사용했나요?\n(현재 ${item.quantity}${item.unit})`, '1');
    if (input === null) return;
    const used = parseFloat(input);
    if (isNaN(used) || used <= 0) { alert('0보다 큰 숫자를 입력해 주세요.'); return; }

    if (used >= item.quantity) {
      // 전부 사용 → 목록에서 제거
      if (confirm('전부 사용한 걸로 처리하고 목록에서 뺄까요?')) {
        commitItems(state.items.filter((i) => i.id !== id));
      }
    } else {
      const left = Math.round((item.quantity - used) * 100) / 100; // 소수점 오차 방지
      commitItems(state.items.map((i) => (i.id === id ? { ...i, quantity: left } : i)));
    }
  }
}

/* ---------- 6) 재료 추가/수정 폼 ---------- */
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModals() {
  document.querySelectorAll('.overlay').forEach((el) => el.classList.add('hidden'));
}

function updatePhotoPreview() {
  $('#photoPreview').innerHTML = state.photo ? `<img src="${state.photo}" alt="미리보기">` : '<span>📷</span>';
  $('#photoRemove').classList.toggle('hidden', !state.photo);
}

function openItemForm(item) {
  const form = $('#itemForm');
  form.reset();
  state.editingId = item ? item.id : null;
  state.photo = item ? item.photo || '' : '';
  $('#itemModalTitle').textContent = item ? '재료 수정' : '재료 추가';
  $('#expiryHint').classList.add('hidden');

  if (item) {
    $('#f-name').value = item.name;
    $('#f-category').value = item.category;
    $('#f-location').value = item.location;
    $('#f-qty').value = item.quantity;
    $('#f-unit').value = item.unit;
    $('#f-dateType').value = item.dateType;
    $('#f-expiry').value = item.expiry;
    $('#f-memo').value = item.memo || '';
  } else {
    $('#f-category').value = '기타';
    $('#f-unit').value = '개';
  }

  updatePhotoPreview();
  openModal('#itemModal');
  $('#f-name').focus();
}

// 이름이 자주 쓰는 재료와 같으면 카테고리·위치·단위·기한을 자동으로 채워준다 (새로 추가할 때만)
function applyPreset() {
  if (state.editingId) return;
  const name = $('#f-name').value.trim();
  const preset = PRESETS.find((p) => p.name === name);
  if (!preset) return;

  $('#f-category').value = preset.cat;
  $('#f-location').value = preset.loc;
  $('#f-unit').value = preset.unit;

  if (!$('#f-expiry').value) {
    const d = todayStart();
    d.setDate(d.getDate() + preset.days);
    $('#f-expiry').value = toDateStr(d);
    const hint = $('#expiryHint');
    hint.textContent = `💡 ${preset.loc} 보관 시 평균 ${preset.days}일 기준으로 넣은 날짜예요. 포장지의 실제 기한으로 고쳐 주세요.`;
    hint.classList.remove('hidden');
  }
}

async function handlePhotoChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    state.photo = await compressImage(file);
    updatePhotoPreview();
  } catch (err) {
    alert('사진을 불러오지 못했어요. 다른 사진으로 시도해 주세요.');
  }
}

function handleFormSubmit(e) {
  e.preventDefault();

  const data = {
    name: $('#f-name').value.trim(),
    category: $('#f-category').value,
    location: $('#f-location').value,
    quantity: parseFloat($('#f-qty').value),
    unit: $('#f-unit').value,
    dateType: $('#f-dateType').value,
    expiry: $('#f-expiry').value,
    memo: $('#f-memo').value.trim(),
    photo: state.photo
  };

  if (!data.name) { alert('식재료명을 입력해 주세요.'); return; }
  if (!(data.quantity > 0)) { alert('수량은 0보다 커야 해요.'); return; }
  if (!data.expiry) { alert('기한 날짜를 입력해 주세요.'); return; }

  let newItems;
  if (state.editingId) {
    newItems = state.items.map((i) => (i.id === state.editingId ? { ...i, ...data } : i));
  } else {
    newItems = [...state.items, { id: uid(), createdAt: Date.now(), ...data }];
  }

  if (commitItems(newItems)) closeModals();
}

/* ---------- 7) 레시피 추천 ---------- */
// 재료 이름 → 대표 이름 집합으로 변환 (예: '계란' → '달걀')
function toCanonicals(name) {
  const n = name.replace(/\s/g, '');
  const result = new Set();
  for (const group of ALIAS_GROUPS) {
    // 한 글자 별칭(밥, 김, 파 등)은 정확히 같을 때만, 두 글자 이상은 포함되면 일치로 본다
    if (group.some((a) => n === a || (a.length >= 2 && n.includes(a)))) {
      result.add(group[0]);
    }
  }
  if (result.size === 0) result.add(n); // 목록에 없는 재료는 이름 그대로 사용
  return result;
}

// 내가 가진(만료되지 않은) 재료 지도: 대표 이름 → 해당 재료들
function buildOwnedMap() {
  const map = new Map();
  state.items.forEach((item) => {
    if (getStatus(item).key === 'expired') return; // 만료 재료는 추천에서 제외
    toCanonicals(item.name).forEach((c) => {
      if (!map.has(c)) map.set(c, []);
      map.get(c).push(item);
    });
  });
  return map;
}

// 레시피 하나를 평가해서 점수와 부족 재료를 계산
function evaluateRecipe(recipe, owned) {
  const must = recipe.must.filter((x) => !STAPLES.includes(x));
  const have = must.filter((x) => owned.has(x));
  const missing = must.filter((x) => !owned.has(x));
  const optHave = (recipe.opt || []).filter((x) => owned.has(x));

  // 이 레시피로 쓸 수 있는 '임박' 재료 찾기
  const urgentItems = new Map();
  [...have, ...optHave].forEach((x) => {
    owned.get(x).forEach((it) => {
      if (getStatus(it).key === 'soon') urgentItems.set(it.id, it);
    });
  });

  const rate = must.length ? have.length / must.length : 1;
  // 점수 = 일치율 + 임박 재료 가산점 + 선택 재료 보너스
  const score = rate * 100 + urgentItems.size * 20 + optHave.length * 3;

  return { recipe, must, have, missing, optHave, rate, urgentCount: urgentItems.size, score };
}

function recipeCardHTML(r, index) {
  const tags = [
    ...r.have.map((x) => `<span class="tag have">✓ ${esc(x)}</span>`),
    ...r.missing.map((x) => `<span class="tag miss">${esc(x)} 없음</span>`)
  ].join('');
  const urgent = r.urgentCount > 0
    ? `<span class="tag urgent">🔥 임박 재료 ${r.urgentCount}개 사용</span>` : '';

  return `
    <article class="recipe-card" data-index="${index}">
      <div class="top">
        <span class="emoji">${r.recipe.emoji}</span>
        <div>
          <h3>${esc(r.recipe.name)}</h3>
          <div class="sub">⏱ ${r.recipe.time} · ${r.recipe.level}</div>
        </div>
      </div>
      <div class="match-bar"><span style="width:${Math.round(r.rate * 100)}%"></span></div>
      <div class="match-text">재료 일치 ${r.have.length}/${r.must.length}</div>
      <div class="tags">${urgent}${tags}</div>
    </article>`;
}

let currentResults = []; // 카드 클릭 시 상세를 열기 위해 보관

function renderRecipes() {
  const box = $('#recipeResult');
  if (state.items.length === 0) {
    box.innerHTML = '<p class="empty">냉장고에 재료를 추가하면 레시피를 추천해 드려요 🍳</p>';
    currentResults = [];
    return;
  }

  const owned = buildOwnedMap();
  const urgentOnly = $('#urgentOnly').checked;

  let results = RECIPES.map((r) => evaluateRecipe(r, owned))
    .filter((r) => r.have.length >= 1 && r.missing.length <= 2) // 재료가 1개 이상 있고 부족이 2개 이하
    .filter((r) => !urgentOnly || r.urgentCount > 0);

  results.sort((a, b) => b.score - a.score);
  currentResults = results;

  const ready = results.filter((r) => r.missing.length === 0);
  const almost = results.filter((r) => r.missing.length > 0);

  let html = '';
  if (ready.length) {
    html += `<section class="recipe-section"><h2>✅ 바로 만들 수 있어요 (${ready.length})</h2>
      <div class="recipe-grid">${ready.map((r) => recipeCardHTML(r, results.indexOf(r))).join('')}</div></section>`;
  }
  if (almost.length) {
    html += `<section class="recipe-section"><h2>🛒 재료 1~2개만 더 있으면 돼요 (${almost.length})</h2>
      <div class="recipe-grid">${almost.map((r) => recipeCardHTML(r, results.indexOf(r))).join('')}</div></section>`;
  }
  if (!html) {
    html = `<p class="empty">${urgentOnly ? '임박한 재료로 만들 수 있는 레시피가 없어요.' : '지금 재료로 추천할 레시피가 없어요. 재료를 더 추가해 보세요!'}</p>`;
  }
  box.innerHTML = html;
}

function openRecipeDetail(index) {
  const r = currentResults[index];
  if (!r) return;
  const rec = r.recipe;

  const ingredients = [
    ...rec.must.map((x) => {
      const isStaple = STAPLES.includes(x);
      const has = isStaple || r.have.includes(x);
      return `<li class="${has ? '' : 'no'}">${has ? '✅' : '❌'} ${esc(x)}</li>`;
    }),
    ...(rec.opt || []).map((x) => `<li>${r.optHave.includes(x) ? '✅' : '➖'} ${esc(x)} <small>(선택)</small></li>`)
  ].join('');

  $('#recipeModalTitle').textContent = `${rec.emoji} ${rec.name}`;
  $('#recipeModalBody').innerHTML = `
    <p class="hint-text">⏱ ${rec.time} · 난이도 ${rec.level}</p>
    <h3>재료</h3>
    <ul class="ing-list">${ingredients}</ul>
    <p class="hint-text">기본 양념(소금, 간장, 식용유 등)은 있다고 가정했어요.</p>
    <h3>만드는 법</h3>
    <ol class="steps">${rec.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  openModal('#recipeModal');
}

/* ---------- 8) 초기화 ---------- */
function init() {
  // 셀렉트/자동완성 목록 채우기
  $('#f-category').innerHTML = Object.keys(CATEGORY_EMOJI).map((c) => `<option>${c}</option>`).join('');
  $('#f-unit').innerHTML = UNITS.map((u) => `<option>${u}</option>`).join('');
  $('#presetList').innerHTML = PRESETS.map((p) => `<option value="${p.name}">`).join('');

  state.items = storage.load();

  // 탭 전환
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.tab-panel').forEach((p) => {
        p.classList.toggle('active', p.id === `tab-${tab.dataset.tab}`);
      });
    });
  });

  // 검색 / 정렬 / 필터
  $('#searchInput').addEventListener('input', (e) => { state.search = e.target.value; renderItems(); });
  $('#sortSelect').addEventListener('change', (e) => { state.sort = e.target.value; renderItems(); });
  $('#statusFilter').addEventListener('change', (e) => { state.status = e.target.value; renderItems(); });
  $('#locationFilter').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.location = chip.dataset.loc;
    document.querySelectorAll('#locationFilter .chip').forEach((c) => c.classList.toggle('active', c === chip));
    renderItems();
  });

  // 카드 버튼
  $('#itemList').addEventListener('click', handleItemAction);

  // 폼
  $('#addBtn').addEventListener('click', () => openItemForm(null));
  $('#itemForm').addEventListener('submit', handleFormSubmit);
  $('#f-name').addEventListener('change', applyPreset);
  $('#f-expiry').addEventListener('input', () => $('#expiryHint').classList.add('hidden'));
  $('#f-photo').addEventListener('change', handlePhotoChange);
  $('#photoRemove').addEventListener('click', () => {
    state.photo = '';
    $('#f-photo').value = '';
    updatePhotoPreview();
  });

  // 모달 닫기 (✕/취소 버튼, 바깥 클릭, ESC)
  document.querySelectorAll('.overlay').forEach((ov) => {
    ov.addEventListener('click', (e) => {
      if (e.target === ov || e.target.closest('[data-close]')) closeModals();
    });
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });

  // 레시피
  $('#urgentOnly').addEventListener('change', renderRecipes);
  $('#recipeResult').addEventListener('click', (e) => {
    const card = e.target.closest('.recipe-card');
    if (card) openRecipeDetail(Number(card.dataset.index));
  });

  // 다른 탭에 다녀오면(날짜가 바뀌었을 수 있으니) 다시 계산
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderAll(); });

  renderAll();
}

init();
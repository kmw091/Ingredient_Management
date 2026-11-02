'use strict';

/* =====================================================
   script.js : 나만의 냉장고 메인 로직
   구성: 1) 상수/상태  2) 저장소  3) 유틸  4) 기한 계산
          5) 목록 화면  6) 입력 폼  7) 레시피 추천
          8) 모바일 UI(홈·선택 모드·하단 탭)  9) 초기화
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
  photo: '',          // 폼에서 선택한 사진(압축된 dataURL)
  selectMode: false,  // 여러 개 선택(비우기) 모드 여부
  selected: new Set(),// 선택된 재료 id 모음
  homeExpand: false   // 홈 '오늘 확인해 주세요' 더보기 펼침 여부
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
  // 요약 숫자는 홈 화면(renderHome)에서 보여주고, 여기서는 경고 배너만 만든다
  const expired = state.items.filter((i) => getStatus(i).key === 'expired').length;
  const soon = state.items.filter((i) => getStatus(i).key === 'soon').length;

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
    <article class="item-card ${st.key}${state.selected.has(item.id) ? ' selected' : ''}" data-id="${item.id}">
      <span class="sel-check" aria-hidden="true">✓</span>
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

  // 필터로 안 보이게 된 재료는 선택에서 뺀다 (안 보이는 재료가 실수로 지워지는 것 방지)
  const visibleIds = new Set(list.map((i) => i.id));
  state.selected.forEach((id) => { if (!visibleIds.has(id)) state.selected.delete(id); });
  updateSelectBar();

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

// 저장 공간이 80% 이상일 때만 경고 문구를 보여준다 (평소에는 숨김)
function renderStorageInfo() {
  const percent = storage.usedPercent();
  const el = $('#storageInfo');
  if (!el) return;
  const full = percent >= 80;
  el.classList.toggle('hidden', !full);
  el.classList.toggle('danger', full);
  el.textContent = full
    ? `⚠️ 저장 공간이 ${percent}% 찼어요. 오래된 재료나 사진을 정리해 주세요.`
    : '';
}

function renderAll() {
  renderSummary();
  renderItems();
  renderStorageInfo();
  renderHome();
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
  // 선택 모드: 카드를 누르면 선택/해제
  if (state.selectMode) {
    const selCard = e.target.closest('.item-card');
    if (selCard) toggleSelect(selCard.dataset.id, selCard);
    return;
  }

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

/* ---------- 8) 모바일 UI : 홈 / 선택 모드 / 하단 탭 ----------
   홈 탭, 하단 탭바, 선택 바는 여기서 만들어 붙이고 스타일도 함께 넣는다.
   (나중에 MOBILE_CSS 내용은 style.css로 옮겨도 된다) */
let fridgeTab = 'fridge'; // '내 냉장고' 탭 이름 (injectMobileUI에서 실제 값으로 갱신)

const MOBILE_CSS = `
.hidden{display:none!important}
html{background:#dbe7e5}
body{max-width:480px;margin:0 auto;min-height:100vh;background:#f4fbfa;padding-bottom:150px;box-shadow:0 0 24px rgba(0,0,0,.08);-webkit-tap-highlight-color:transparent}
input,select,textarea{font-size:16px}

/* 하단 탭바 */
.bottom-nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;display:flex;margin:0;padding:0 0 env(safe-area-inset-bottom);background:#fff;border-top:1px solid #d6e6e3;z-index:50}
.bottom-nav .tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 0 10px;font-size:11px;background:none;border:0;border-radius:0;box-shadow:none;color:#7a8f8c;cursor:pointer}
.bottom-nav .tab.active{color:#0f9d8a;font-weight:700;background:none;box-shadow:none}
.bottom-nav .tab-ico{font-size:22px;line-height:1}

/* 추가(+) 버튼은 탭바 위에 */
#addBtn{position:fixed!important;bottom:calc(76px + env(safe-area-inset-bottom))!important;right:max(16px, calc(50% - 224px))!important;left:auto!important;z-index:40}

/* 모달 → 아래에서 올라오는 바텀시트 */
.overlay{align-items:flex-end!important;justify-content:center!important;padding:0!important}
.overlay>*{width:100%;max-width:480px;max-height:92vh;overflow-y:auto;margin:0!important;border-radius:20px 20px 0 0!important;animation:sheetUp .25s ease}
@keyframes sheetUp{from{transform:translateY(40px);opacity:0}to{transform:none;opacity:1}}
.item-actions button{min-height:40px}

/* 저장 공간 경고 (80% 이상일 때만 보임) */
#storageInfo.danger{margin:8px 16px;padding:10px 12px;border-radius:12px;background:#fff0f0;border:1px solid #f5c2c2;color:#c0392b;font-size:13px;font-weight:600}

/* 홈 */
#homeContent{padding:14px 16px 0}
.sum-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.sum-card{display:block;width:100%;text-align:left;font:inherit;background:#fff;border:1px solid #d6e6e3;border-radius:16px;padding:14px;color:#1d3a36;cursor:pointer}
.sum-card:active{transform:scale(.98)}
.sum-head{display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#5b706d}
.sum-ico{font-size:20px}
.sum-num{font-size:30px;font-weight:800;margin:10px 0 4px}
.sum-card.soon .sum-num{color:#e08a00}
.sum-card.expired .sum-num{color:#e5484d}
.sum-sub{font-size:12px;color:#6f8481}
.home-divider{height:1px;background:#d6e6e3;margin:22px 0 18px}
.today-title{font-size:17px;margin:0 0 4px}
.today-row{display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;text-align:left;font:inherit;background:none;border:0;border-bottom:1px solid #e1eeec;padding:14px 2px;color:inherit;cursor:pointer}
.today-name{font-size:17px;font-weight:700}
.today-sub{font-size:13px;color:#6f8481;margin-top:3px}
.due-badge{flex-shrink:0;padding:7px 12px;border-radius:999px;font-size:13px;font-weight:700}
.due-badge.soon{background:#fff1e0;color:#d9730d}
.due-badge.expired{background:#ffe5e5;color:#d93036}
.today-empty{color:#6f8481;padding:18px 0;text-align:center}
.more-btn{display:block;width:100%;margin-top:10px;padding:12px;font:inherit;font-weight:600;color:#0f6f63;background:#fff;border:1px solid #bcd9d4;border-radius:12px;cursor:pointer}

/* 선택(비우기) 모드 */
.select-toolbar{display:flex;justify-content:flex-end;margin:8px 0}
.sel-btn{border:1px solid #bcd9d4;background:#fff;color:#0f6f63;border-radius:999px;padding:9px 16px;font-size:14px;font-weight:600;cursor:pointer}
.select-bar{display:none;position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;z-index:70;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:#fff;border-top:1px solid #d6e6e3;box-shadow:0 -4px 14px rgba(0,0,0,.08)}
body.select-mode .select-bar{display:flex}
body.select-mode .bottom-nav,body.select-mode #addBtn{display:none!important}
.select-bar .sel-btn{flex:1;border-radius:12px;padding:12px 4px}
.sel-danger{background:#e5484d;border-color:#e5484d;color:#fff}
.sel-danger:disabled{opacity:.4}
.item-card{position:relative}
.sel-check{display:none}
body.select-mode .item-actions{display:none}
body.select-mode .item-card{cursor:pointer}
body.select-mode .sel-check{display:flex;position:absolute;top:10px;left:10px;width:26px;height:26px;border-radius:50%;border:2px solid #9bbab5;background:#fff;color:transparent;align-items:center;justify-content:center;font-size:15px;font-weight:700;z-index:2}
body.select-mode .item-card.selected .sel-check{background:#14b8a6;border-color:#14b8a6;color:#fff}
body.select-mode .item-card.selected{outline:3px solid #14b8a6;outline-offset:-3px}

/* 홈에서 눌러 이동했을 때 카드 강조 */
@keyframes flashCard{0%,100%{box-shadow:0 0 0 0 rgba(20,184,166,0)}30%{box-shadow:0 0 0 5px rgba(20,184,166,.55)}}
.item-card.flash{animation:flashCard .6s ease 3}
`;

// 홈 탭 / 하단 탭바 / 선택 바를 화면에 만들어 붙인다
function injectMobileUI() {
  const style = document.createElement('style');
  style.id = 'mobileStyle';
  style.textContent = MOBILE_CSS;
  document.head.appendChild(style);

  // 탭 글자를 '아이콘 + 라벨' 두 줄로 바꾸기 (예: '🧊 내 냉장고')
  document.querySelectorAll('.tab').forEach((tab) => {
    const m = tab.textContent.trim().match(/^(\S+)\s+(.+)$/);
    if (m) tab.innerHTML = `<span class="tab-ico">${esc(m[1])}</span><span class="tab-label">${esc(m[2])}</span>`;
  });

  // 홈 탭 버튼을 맨 앞에 추가하고, 탭 전체를 화면 아래 고정 바로 옮긴다
  const firstTab = document.querySelector('.tab');
  const oldParent = firstTab.parentElement;
  const homeTab = document.createElement('button');
  homeTab.type = 'button';
  homeTab.className = 'tab';
  homeTab.dataset.tab = 'home';
  homeTab.innerHTML = '<span class="tab-ico">🏠</span><span class="tab-label">홈</span>';
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.appendChild(homeTab);
  document.querySelectorAll('.tab').forEach((t) => { if (t !== homeTab) nav.appendChild(t); });
  document.body.appendChild(nav);
  if (!oldParent.children.length) oldParent.style.display = 'none';

  // 홈 화면 패널을 '내 냉장고' 패널 앞에 추가
  const list = $('#itemList');
  const fridgePanel = list.closest('.tab-panel') || document.querySelector('.tab-panel');
  fridgeTab = fridgePanel.id.replace(/^tab-/, '');
  const home = document.createElement('section');
  home.className = 'tab-panel';
  home.id = 'tab-home';
  home.innerHTML = '<div id="homeContent"></div>';
  fridgePanel.parentElement.insertBefore(home, fridgePanel);

  // 예전 요약 바는 홈으로 옮겼으니 숨김
  const oldSummary = $('#summaryBar');
  if (oldSummary) oldSummary.classList.add('hidden');

  // 목록 위 '선택' 버튼
  const toolbar = document.createElement('div');
  toolbar.className = 'select-toolbar';
  toolbar.innerHTML = '<button type="button" id="selectToggle" class="sel-btn">☑ 선택</button>';
  list.parentElement.insertBefore(toolbar, list);

  // 선택 모드일 때 화면 아래에 뜨는 바
  const selectBar = document.createElement('div');
  selectBar.className = 'select-bar';
  selectBar.innerHTML = `
    <button type="button" id="selAll" class="sel-btn">전체 선택</button>
    <button type="button" id="selEmpty" class="sel-btn sel-danger" disabled>🗑 비우기</button>
    <button type="button" id="selCancel" class="sel-btn">취소</button>`;
  document.body.appendChild(selectBar);
}

// 탭 전환 (홈 / 내 냉장고 / 레시피)
function switchTab(name) {
  if (state.selectMode) setSelectMode(false);
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  window.scrollTo(0, 0);
}

// 필터를 초기화(또는 지정)하고 '내 냉장고' 탭으로 이동
function showFridge(filters = {}) {
  state.search = '';
  state.status = filters.status || 'all';
  state.location = filters.location || 'all';
  $('#searchInput').value = '';
  $('#statusFilter').value = state.status;
  document.querySelectorAll('#locationFilter .chip').forEach((c) => {
    c.classList.toggle('active', c.dataset.loc === state.location);
  });
  switchTab(fridgeTab);
  renderItems();
}

// 홈에서 재료를 누르면 해당 카드로 스크롤하고 잠깐 강조
function goToItem(id) {
  showFridge();
  requestAnimationFrame(() => {
    const card = document.querySelector(`.item-card[data-id="${id}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('flash');
    setTimeout(() => card.classList.remove('flash'), 1800);
  });
}

// 보관 위치 목록 (필터 칩에서 읽어 오고, 없으면 기본값)
function getLocations() {
  const locs = [...document.querySelectorAll('#locationFilter .chip')]
    .map((c) => c.dataset.loc)
    .filter((l) => l && l !== 'all');
  return locs.length ? locs : ['냉장', '냉동', '실온'];
}

function ddayText(days) {
  if (days < 0) return `D+${-days}`;
  if (days === 0) return 'D-Day';
  return `D-${days}`;
}

function dueBadge(days) {
  if (days < 0) return { cls: 'expired', text: `${-days}일 지남` };
  if (days === 0) return { cls: 'expired', text: '오늘 만료' };
  if (days === 1) return { cls: 'soon', text: '내일 만료' };
  return { cls: 'soon', text: `${days}일 후 만료` };
}

// 홈 화면: 요약 카드 4개 + '오늘 확인해 주세요' 목록
function renderHome() {
  const box = $('#homeContent');
  if (!box) return;

  const withStatus = state.items.map((item) => ({ item, st: getStatus(item) }));
  const soon = withStatus.filter((x) => x.st.key === 'soon').length;
  const expired = withStatus.filter((x) => x.st.key === 'expired').length;
  const locCounts = getLocations().map((name) => ({
    name, n: state.items.filter((i) => i.location === name).length
  }));
  const usedLocs = locCounts.filter((l) => l.n > 0).length;

  const LIMIT = 5; // 처음에 보여줄 개수
  const urgent = withStatus.filter((x) => x.st.key !== 'safe').sort((a, b) => a.st.days - b.st.days);
  const shown = state.homeExpand ? urgent : urgent.slice(0, LIMIT);

  let listHTML;
  if (state.items.length === 0) {
    listHTML = '<p class="today-empty">냉장고가 비어 있어요.<br>오른쪽 아래 + 버튼으로 재료를 추가해 보세요!</p>';
  } else if (urgent.length === 0) {
    listHTML = '<p class="today-empty">확인할 재료가 없어요. 냉장고가 안전해요 👍</p>';
  } else {
    listHTML = shown.map(({ item, st }) => {
      const b = dueBadge(st.days);
      return `
        <button type="button" class="today-row" data-id="${item.id}">
          <div>
            <div class="today-name">${esc(item.name)}</div>
            <div class="today-sub">${esc(item.location)} 보관 · ${esc(item.dateType)}기한 ${ddayText(st.days)}</div>
          </div>
          <span class="due-badge ${b.cls}">${b.text}</span>
        </button>`;
    }).join('');
    if (urgent.length > LIMIT) {
      listHTML += `<button type="button" id="homeMore" class="more-btn">${
        state.homeExpand ? '접기' : `더보기 (${urgent.length - LIMIT}개)`}</button>`;
    }
  }

  box.innerHTML = `
    <div class="sum-grid">
      <button type="button" class="sum-card" data-go="all">
        <div class="sum-head"><span class="sum-ico">📦</span><span>전체 재료</span></div>
        <div class="sum-num">${state.items.length}개</div>
        <div class="sum-sub">현재 등록된 식재료</div>
      </button>
      <button type="button" class="sum-card soon" data-go="soon">
        <div class="sum-head"><span class="sum-ico">⏰</span><span>기한 임박</span></div>
        <div class="sum-num">${soon}개</div>
        <div class="sum-sub">${SOON_DAYS}일 이내 만료 예정</div>
      </button>
      <button type="button" class="sum-card expired" data-go="expired">
        <div class="sum-head"><span class="sum-ico">⚠️</span><span>기한 만료</span></div>
        <div class="sum-num">${expired}개</div>
        <div class="sum-sub">확인이 필요한 재료</div>
      </button>
      <button type="button" class="sum-card" data-go="all">
        <div class="sum-head"><span class="sum-ico">🧊</span><span>보관 위치</span></div>
        <div class="sum-num">${usedLocs}곳</div>
        <div class="sum-sub">${locCounts.map((l) => `${esc(l.name)} ${l.n}`).join(' · ')}</div>
      </button>
    </div>
    <div class="home-divider"></div>
    <h2 class="today-title">⚠️ 오늘 확인해 주세요</h2>
    ${listHTML}`;
}

/* --- 여러 개 선택해서 한 번에 비우기 --- */
function setSelectMode(on) {
  state.selectMode = on;
  state.selected.clear();
  document.body.classList.toggle('select-mode', on);
  $('#selectToggle').textContent = on ? '✕ 선택 취소' : '☑ 선택';
  renderItems();
}

function toggleSelect(id, card) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  card.classList.toggle('selected', state.selected.has(id));
  updateSelectBar();
}

function updateSelectBar() {
  const emptyBtn = $('#selEmpty');
  if (!emptyBtn) return;
  const n = state.selected.size;
  emptyBtn.textContent = n ? `🗑 ${n}개 비우기` : '🗑 비우기';
  emptyBtn.disabled = n === 0;
  const visible = getVisibleItems().length;
  $('#selAll').textContent = (n > 0 && n === visible) ? '전체 해제' : '전체 선택';
}

function toggleSelectAll() {
  const list = getVisibleItems();
  const allOn = list.length > 0 && list.every((i) => state.selected.has(i.id));
  state.selected.clear();
  if (!allOn) list.forEach((i) => state.selected.add(i.id));
  renderItems();
}

function emptySelected() {
  const n = state.selected.size;
  if (!n) return;
  if (!confirm(`선택한 재료 ${n}개를 냉장고에서 비울까요?\n(되돌릴 수 없어요)`)) return;
  const ids = new Set(state.selected);
  if (commitItems(state.items.filter((i) => !ids.has(i.id)))) setSelectMode(false);
}

function bindMobileEvents() {
  // 홈: 재료 행 / 더보기 / 요약 카드 클릭
  $('#homeContent').addEventListener('click', (e) => {
    const row = e.target.closest('.today-row');
    if (row) { goToItem(row.dataset.id); return; }
    if (e.target.closest('#homeMore')) { state.homeExpand = !state.homeExpand; renderHome(); return; }
    const card = e.target.closest('.sum-card');
    if (!card) return;
    const go = card.dataset.go;
    if (go === 'soon' || go === 'expired') showFridge({ status: go });
    else showFridge();
  });

  // 선택 모드
  $('#selectToggle').addEventListener('click', () => setSelectMode(!state.selectMode));
  $('#selAll').addEventListener('click', toggleSelectAll);
  $('#selEmpty').addEventListener('click', emptySelected);
  $('#selCancel').addEventListener('click', () => setSelectMode(false));
}

/* ---------- 10) AI 레시피 (Ollama 로컬 서버 연결) ----------
   - 주소는 http://localhost:11434 (내 컴퓨터에서 도는 Ollama). API 키는 필요 없다.
   - 흐름: 냉장고 재료 → 프롬프트 → /api/generate 호출 → JSON 응답을 카드로 표시 */
const AI = {
  BASE: 'http://localhost:11434',
  MODEL_KEY: 'myFridge.ollamaModel',
  CACHE_KEY: 'myFridge.aiRecipes.v1',
  TIMEOUT_MS: 180000 // 로컬 모델은 느릴 수 있어서 3분까지 기다린다
};

const AI_CSS = `
.ai-box{margin:12px 0;padding:14px;border-radius:16px;background:#f0fbf9;border:1px solid #bfeae3}
.ai-box h3{margin:0 0 4px;font-size:16px}
.ai-box .ai-desc{margin:0 0 10px;font-size:12px;color:#5b7a76}
.ai-row{display:flex;gap:8px;align-items:center;margin-bottom:8px}
.ai-row select{flex:1;min-width:0;padding:10px;border-radius:10px;border:1px solid #bfeae3;background:#fff;font-size:16px}
.ai-btn{width:100%;padding:13px;border:0;border-radius:12px;background:#2bb5a0;color:#fff;font-size:16px;font-weight:700;cursor:pointer}
.ai-btn:disabled{background:#9ccfc7;cursor:wait}
.ai-status{margin:10px 0 0;font-size:13px;line-height:1.5;color:#5b7a76;white-space:pre-line}
.ai-status.error{color:#d64545}
.ai-card{margin-top:10px;background:#fff;border:1px solid #d6eeea;border-radius:14px;padding:12px}
.ai-card summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;font-weight:700}
.ai-card summary::-webkit-details-marker{display:none}
.ai-tag{font-size:11px;font-weight:700;color:#fff;background:#7b61ff;border-radius:999px;padding:2px 8px}
.ai-meta{margin:8px 0 4px;font-size:12px;color:#5b7a76}
.ai-card h4{margin:10px 0 4px;font-size:13px}
.ai-card ul,.ai-card ol{margin:0;padding-left:20px;font-size:14px;line-height:1.6}
.ai-tip{margin-top:8px;padding:8px 10px;border-radius:10px;background:#fff8e6;font-size:13px}
.ai-note{margin-top:10px;font-size:11px;color:#8a9a97}
`;

// 현재 냉장고에서 AI에게 보낼 재료 뽑기 (만료된 재료는 제외)
function getAiIngredients() {
  return state.items
    .map((item) => ({ item, st: getStatus(item) }))
    .filter((x) => x.st.key !== 'expired')
    .sort((a, b) => a.st.days - b.st.days)
    .slice(0, 25); // 프롬프트가 너무 길어지지 않게 제한
}

function buildAiPrompt(list) {
  const lines = list.map(({ item, st }) =>
    `- ${item.name} ${item.quantity}${item.unit} (${st.key === 'soon' ? '기한 임박, 먼저 사용' : '여유 있음'})`
  ).join('\n');

  return `너는 자취생을 위한 요리 도우미야. 아래 냉장고 재료로 만들 수 있는 간단한 레시피를 정확히 3개 추천해 줘.

[냉장고 재료]
${lines}

[규칙]
1. 재료는 위 목록과 기본 양념(소금, 설탕, 후추, 간장, 식용유, 참기름, 고추장, 고춧가루, 물)만 사용해.
2. '기한 임박' 재료를 최대한 많이 쓰는 레시피를 먼저 추천해.
3. 자취생이 20분 안팎으로 만들 수 있는 쉬운 요리로 해.
4. 조리 단계는 3~7단계로 짧고 명확하게 써. 고기·달걀은 충분히 익히라고 안내해.
5. 반드시 한국어로, 아래 JSON 형식으로만 답해. 다른 말은 쓰지 마.

{"recipes":[{"name":"요리 이름","emoji":"이모지 1개","time":"조리 시간(예: 15분)","difficulty":"쉬움","ingredients":["재료 1","재료 2"],"steps":["1단계","2단계"],"tip":"한 줄 팁"}]}`;
}

// 설치된 Ollama 모델 목록 가져오기 (실패하면 빈 배열)
async function fetchAiModels() {
  try {
    const res = await fetch(`${AI.BASE}/api/tags`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map((m) => m.name);
  } catch (e) {
    return [];
  }
}

// AI 응답 글자에서 JSON만 안전하게 꺼내기
function parseAiJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    const s = text.indexOf('{');
    const t = text.lastIndexOf('}');
    if (s < 0 || t <= s) throw new Error('AI 응답을 읽지 못했어요.');
    data = JSON.parse(text.slice(s, t + 1));
  }
  const arr = Array.isArray(data) ? data : data.recipes;
  if (!Array.isArray(arr) || arr.length === 0) throw new Error('레시피가 비어 있어요.');

  // 형식이 조금 틀려도 화면이 깨지지 않게 문자열로 정리
  return arr.slice(0, 5).map((r) => ({
    name: String(r.name || '이름 없는 레시피'),
    emoji: String(r.emoji || '🍳'),
    time: String(r.time || ''),
    difficulty: String(r.difficulty || ''),
    ingredients: (Array.isArray(r.ingredients) ? r.ingredients : []).map(String),
    steps: (Array.isArray(r.steps) ? r.steps : []).map(String),
    tip: String(r.tip || '')
  }));
}

// Ollama에 레시피 요청
async function requestAiRecipes(model, prompt) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI.TIMEOUT_MS);
  try {
    const res = await fetch(`${AI.BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false, format: 'json' }),
      signal: ctrl.signal
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      throw new Error(`Ollama 오류 (${res.status}) ${msg.slice(0, 120)}`);
    }
    const data = await res.json();
    return parseAiJson(data.response || '');
  } finally {
    clearTimeout(timer);
  }
}

function aiRecipeCardHTML(r) {
  return `
    <details class="ai-card">
      <summary><span>${esc(r.emoji)}</span><span>${esc(r.name)}</span><span class="ai-tag">AI 추천</span></summary>
      <div class="ai-meta">${r.time ? `⏱ ${esc(r.time)}` : ''}${r.difficulty ? ` · ${esc(r.difficulty)}` : ''}</div>
      <h4>재료</h4>
      <ul>${r.ingredients.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
      <h4>만드는 법</h4>
      <ol>${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      ${r.tip ? `<div class="ai-tip">💡 ${esc(r.tip)}</div>` : ''}
    </details>`;
}

function renderAiRecipes(recipes, savedAt) {
  const box = $('#aiResult');
  if (!box) return;
  const when = savedAt ? new Date(savedAt).toLocaleString('ko-KR') : '';
  box.innerHTML = recipes.map(aiRecipeCardHTML).join('') +
    `<p class="ai-note">※ AI가 만든 참고용 레시피예요. 조리 전에 재료 상태와 익힘 정도를 꼭 확인하세요.${when ? `<br>생성: ${esc(when)}` : ''}</p>`;
}

function setAiStatus(text, isError) {
  const el = $('#aiStatus');
  el.textContent = text;
  el.classList.toggle('error', !!isError);
}

async function handleAiClick() {
  const btn = $('#aiBtn');
  const list = getAiIngredients();
  if (list.length === 0) {
    setAiStatus('먹을 수 있는 재료가 없어요. 먼저 재료를 추가해 주세요.', true);
    return;
  }

  const model = $('#aiModel').value;
  if (!model) {
    setAiStatus('Ollama에 연결할 수 없어요.\n① Ollama가 켜져 있는지 확인하고\n② 터미널에서 OLLAMA_ORIGINS="*" 설정 후 다시 실행해 보세요.\n(모델이 없다면 ollama pull 모델이름 으로 먼저 받아야 해요)', true);
    refreshAiModels();
    return;
  }

  btn.disabled = true;
  btn.textContent = '레시피 만드는 중...';
  setAiStatus(`🤖 ${model} 모델이 레시피를 만들고 있어요. 잠시만 기다려 주세요.`);

  try {
    const recipes = await requestAiRecipes(model, buildAiPrompt(list));
    renderAiRecipes(recipes, Date.now());
    try {
      localStorage.setItem(AI.CACHE_KEY, JSON.stringify({ at: Date.now(), recipes }));
    } catch (e) { /* 캐시 저장 실패는 무시 */ }
    setAiStatus(`✅ 재료 ${list.length}개로 레시피 ${recipes.length}개를 만들었어요.`);
  } catch (e) {
    const msg = e.name === 'AbortError'
      ? '응답이 너무 오래 걸려서 중단했어요. 더 작은 모델로 다시 시도해 보세요.'
      : `레시피를 만들지 못했어요.\n${e.message}`;
    setAiStatus(msg, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ AI 레시피 만들기';
  }
}

// 모델 목록을 불러와 선택창에 채우기 (이전에 고른 모델은 기억)
async function refreshAiModels() {
  const select = $('#aiModel');
  if (!select) return;
  const models = await fetchAiModels();
  const saved = localStorage.getItem(AI.MODEL_KEY);
  select.innerHTML = models.length
    ? models.map((m) => `<option value="${esc(m)}"${m === saved ? ' selected' : ''}>${esc(m)}</option>`).join('')
    : '<option value="">연결 안 됨</option>';
}

function initAiRecipe() {
  const anchor = $('#recipeResult');
  if (!anchor) return;

  const style = document.createElement('style');
  style.textContent = AI_CSS;
  document.head.appendChild(style);

  const box = document.createElement('section');
  box.id = 'aiRecipeBox';
  box.className = 'ai-box';
  box.innerHTML = `
    <h3>✨ AI 레시피</h3>
    <p class="ai-desc">내 냉장고 재료로 AI가 새 레시피를 만들어 줘요. 기한이 지난 재료는 빼고, 임박한 재료를 우선 써요.</p>
    <div class="ai-row"><select id="aiModel" aria-label="AI 모델"><option value="">모델 확인 중...</option></select></div>
    <button type="button" id="aiBtn" class="ai-btn">✨ AI 레시피 만들기</button>
    <p id="aiStatus" class="ai-status"></p>
    <div id="aiResult"></div>`;
  anchor.insertAdjacentElement('beforebegin', box);

  $('#aiBtn').addEventListener('click', handleAiClick);
  $('#aiModel').addEventListener('change', (e) => localStorage.setItem(AI.MODEL_KEY, e.target.value));

  // 지난번에 만든 레시피가 있으면 바로 보여준다
  try {
    const cache = JSON.parse(localStorage.getItem(AI.CACHE_KEY));
    if (cache && Array.isArray(cache.recipes)) renderAiRecipes(cache.recipes, cache.at);
  } catch (e) { /* 캐시가 깨졌으면 무시 */ }

  refreshAiModels();
}

/* ---------- 9) 초기화 ---------- */
function init() {
  // 셀렉트/자동완성 목록 채우기
  $('#f-category').innerHTML = Object.keys(CATEGORY_EMOJI).map((c) => `<option>${c}</option>`).join('');
  $('#f-unit').innerHTML = UNITS.map((u) => `<option>${u}</option>`).join('');
  $('#presetList').innerHTML = PRESETS.map((p) => `<option value="${p.name}">`).join('');

  // 홈 탭 · 하단 탭바 · 선택 바 만들기 (탭 이벤트 연결보다 먼저 실행)
  injectMobileUI();

  state.items = storage.load();

  // 탭 전환 (하단 탭바)
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
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

  bindMobileEvents();
  initAiRecipe();
  renderAll();
  switchTab('home'); // 첫 화면은 홈
}

init();
// ── 상수 ─────────────────────────────────────────────
const TIER_DATA = {
  male: [
    { name:'노예',   icon:'⛓',  stars:1, tag:'고난이 가득한 험한 운명' },
    { name:'하층민', icon:'🌑',  stars:2, tag:'평생 고생이 많은 운명' },
    { name:'평민',   icon:'🌿',  stars:3, tag:'평범하지만 안정적인 삶' },
    { name:'귀족',   icon:'💎',  stars:4, tag:'재능과 운이 겹친 복된 삶' },
    { name:'왕자',   icon:'🤴',  stars:5, tag:'타고난 귀함과 카리스마' },
    { name:'황제',   icon:'👑',  stars:6, tag:'천명이 깃든 완벽한 얼굴' },
  ],
  female: [
    { name:'노예',   icon:'⛓',  stars:1, tag:'고난이 가득한 험한 운명' },
    { name:'하층민', icon:'🌑',  stars:2, tag:'평생 고생이 많은 운명' },
    { name:'평민',   icon:'🌿',  stars:3, tag:'평범하지만 안정적인 삶' },
    { name:'귀족',   icon:'💎',  stars:4, tag:'재능과 운이 겹친 복된 삶' },
    { name:'공주',   icon:'👸',  stars:5, tag:'타고난 우아함과 귀한 품격' },
    { name:'황후',   icon:'👑',  stars:6, tag:'천명이 깃든 완벽한 얼굴' },
  ],
};

const OHAENG_COLOR = { 목:'#4caf50', 화:'#f44336', 토:'#ff9800', 금:'#b0bec5', 수:'#2196f3' };
const GWANSANG_META = {
  forehead:   { icon:'🔮', label:'이마' },
  eyes:       { icon:'👁',  label:'눈' },
  nose:       { icon:'👃', label:'코' },
  mouth_chin: { icon:'💬', label:'입·턱' },
  overall:    { icon:'✨', label:'전체 인상' },
};

const MODEL = 'anthropic/claude-opus-4-8';
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// ── 상태 ─────────────────────────────────────────────
const state = {
  gender:   'male',
  year:     null,
  month:    null,
  day:      null,
  sijinIdx: -1,
  photoFile: null,
  photoBase64: null,
  saJu:     null,
  result:   null,
};

// ── 초기화 ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initStars();
  initSelects();
  loadSettings();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});

// ── 별 배경 ───────────────────────────────────────────
function initStars() {
  const canvas = document.getElementById('starCanvas');
  const ctx = canvas.getContext('2d');
  let stars = [];

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    stars = Array.from({ length: 120 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.2 + 0.3,
      a: Math.random(),
      speed: Math.random() * 0.008 + 0.003,
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const t = Date.now() / 1000;
    stars.forEach(s => {
      const alpha = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * s.speed * 20 + s.a * 20));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(232,213,163,${alpha})`;
      ctx.fill();
    });
    requestAnimationFrame(draw);
  }

  resize();
  draw();
  window.addEventListener('resize', resize);
}

// ── 셀렉트 초기화 ─────────────────────────────────────
function initSelects() {
  const monthSel = document.getElementById('inputMonth');
  for (let i = 1; i <= 12; i++) {
    monthSel.add(new Option(`${i}월`, i));
  }

  const daySel = document.getElementById('inputDay');
  for (let i = 1; i <= 31; i++) {
    daySel.add(new Option(`${i}일`, i));
  }

  const hourSel = document.getElementById('inputHour');
  SIJIN.forEach((s, idx) => {
    hourSel.add(new Option(`${s.label}  ${s.desc}`, idx));
  });
}

// ── 뷰 전환 ──────────────────────────────────────────
function showView(id) {
  document.querySelectorAll('.view').forEach(v => {
    v.classList.remove('active');
    v.style.display = 'none';
  });
  const next = document.getElementById(id);
  next.style.display = 'flex';
  requestAnimationFrame(() => next.classList.add('active'));
}

// ── App 공개 API ──────────────────────────────────────
const App = {
  goHome()     { showView('view-home'); },
  goInfo()     { showView('view-info'); },
  goSettings() {
    document.getElementById('apiKeyInput').value = getApiKey();
    showView('view-settings');
  },

  setGender(g) {
    state.gender = g;
    document.getElementById('btnMale').classList.toggle('active', g === 'male');
    document.getElementById('btnFemale').classList.toggle('active', g === 'female');
  },

  goPhoto() {
    const y = parseInt(document.getElementById('inputYear').value);
    const m = parseInt(document.getElementById('inputMonth').value);
    const d = parseInt(document.getElementById('inputDay').value);

    if (!y || y < 1900 || y > new Date().getFullYear()) return alert('올바른 태어난 해를 입력해주세요.');
    if (!m) return alert('월을 선택해주세요.');
    if (!d) return alert('일을 선택해주세요.');

    state.year     = y;
    state.month    = m;
    state.day      = d;
    state.sijinIdx = parseInt(document.getElementById('inputHour').value);

    showView('view-photo');
  },

  onPhoto(input) {
    const file = input.files[0];
    if (!file) return;
    state.photoFile = file;

    const reader = new FileReader();
    reader.onload = e => {
      const img = document.getElementById('previewImg');
      img.src = e.target.result;
      document.getElementById('faceGuide').style.display = 'none';
      document.getElementById('previewArea').style.display = 'block';
      document.getElementById('btnAnalyze').style.display = 'block';
    };
    reader.readAsDataURL(file);
    input.value = '';
  },

  async startAnalysis() {
    const apiKey = getApiKey();
    if (!apiKey) {
      alert('API 키가 없습니다.\n설정에서 OpenRouter API 키를 입력해주세요.');
      App.goSettings();
      return;
    }

    showView('view-loading');
    setLoadingText('사주팔자를 계산하고 있습니다');

    try {
      state.saJu = calculateSaju(state.year, state.month, state.day, state.sijinIdx);

      setLoadingText('얼굴 사진을 준비하고 있습니다');
      state.photoBase64 = await resizeImage(state.photoFile);

      setLoadingText('AI가 관상과 천명을 분석하고 있습니다 (20~40초 소요)');
      const result = await callAI(state.saJu, state.photoBase64, state.gender);
      state.result = result;

      renderResult(result, state.saJu, state.gender);
      showView('view-result');
    } catch (e) {
      console.error(e);
      showView('view-photo');
      alert('분석 중 오류가 발생했습니다.\n' + e.message);
    }
  },

  saveSettings() {
    const key = document.getElementById('apiKeyInput').value.trim();
    if (!key) return alert('API 키를 입력해주세요.');
    localStorage.setItem('gwansang_apiKey', key);
    alert('저장되었습니다.');
    App.goHome();
  },

  share() {
    const r = state.result;
    if (!r) return;
    const tier = TIER_DATA[state.gender][r.tier - 1];
    const text = `[천명관상] 나의 운명 등급은 "${tier.name}" ${tier.icon}\n${tier.tag}\n\n${r.combined_reading?.slice(0, 80)}...`;
    if (navigator.share) {
      navigator.share({ title: '천명관상 결과', text }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text).then(() => alert('클립보드에 복사되었습니다.'));
    }
  },

  retry() {
    state.photoFile    = null;
    state.photoBase64  = null;
    state.result       = null;
    document.getElementById('faceGuide').style.display  = 'flex';
    document.getElementById('previewArea').style.display = 'none';
    document.getElementById('btnAnalyze').style.display  = 'none';
    showView('view-home');
  },
};

// ── 이미지 리사이즈 ───────────────────────────────────
function resizeImage(file, maxSize = 800, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = e => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const ratio  = Math.min(maxSize / img.width, maxSize / img.height, 1);
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * ratio);
        canvas.height = Math.round(img.height * ratio);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── AI 호출 ───────────────────────────────────────────
async function callAI(saJu, base64, gender) {
  const genderLabel = gender === 'male' ? '남성' : '여성';
  const tierNames = TIER_DATA[gender].map((t,i) => `${i+1}=${t.name}(${t.tag})`).join(', ');

  const hourText = saJu.hour
    ? `시주(時柱): ${saJu.hour.char}`
    : '시주(時柱): 불명(생략됨)';

  const oText = Object.entries(saJu.ohaeng)
    .map(([k, v]) => `${k} ${v}%`).join(' · ');

  const prompt = `당신은 수십 년 경력의 사주팔자(四柱八字)와 관상(觀相) 전문가입니다.
첨부된 얼굴 사진을 분석하고, 아래 사주 정보와 통합하여 종합적인 운명 풀이를 해주세요.

[사주 정보]
성별: ${genderLabel}
년주(年柱): ${saJu.year.char}
월주(月柱): ${saJu.month.char}
일주(日柱): ${saJu.day.char}  ← 일간(日干): ${saJu.dayGan}(${saJu.dayOhaeng})
${hourText}
오행 분포: ${oText}

[분석 요청]
1. 사진의 얼굴을 이마·눈·코·입턱·전체 인상으로 나눠 관상을 분석해주세요.
2. 사주와 관상을 통합하여 등급을 판정하고 종합 천명 풀이를 작성해주세요.

반드시 아래 JSON 형식만 반환하세요 (마크다운, 설명 텍스트 불필요):
{
  "tier": 1~6 사이 정수,
  "gwansang": {
    "forehead": "이마 분석 (2문장)",
    "eyes": "눈 분석 (2문장)",
    "nose": "코 분석 (2문장)",
    "mouth_chin": "입·턱 분석 (2문장)",
    "overall": "전체 인상 (2문장)"
  },
  "saju_analysis": "사주팔자 분석 텍스트 (3~4문장)",
  "combined_reading": "관상과 사주를 통합한 종합 천명 풀이 (4~6문장, 등급 이유 포함)"
}

등급 기준: ${tierNames}`;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://dhshin6023.github.io/gwansang-app/',
      'X-Title': '천명관상',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
          { type: 'text', text: prompt },
        ],
      }],
      max_tokens: 3000,
      temperature: 0.5,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API 오류 (${res.status}): ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  let raw = data.choices?.[0]?.message?.content ?? '';
  if (Array.isArray(raw)) {
    raw = raw.find(b => b?.type === 'text')?.text ?? '';
  }
  if (!raw) throw new Error('AI 응답이 비어있습니다. 잠시 후 다시 시도해주세요.');
  return parseJSON(raw);
}

function parseJSON(raw) {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 응답에서 JSON을 찾을 수 없습니다.');
  try {
    return JSON.parse(match[0]);
  } catch {
    throw new Error('AI 응답 파싱 실패: ' + raw.slice(0, 100));
  }
}

// ── 결과 렌더링 ───────────────────────────────────────
function renderResult(result, saJu, gender) {
  const tier   = Math.max(1, Math.min(6, parseInt(result.tier) || 3));
  const tData  = TIER_DATA[gender][tier - 1];

  // 등급 배너
  document.getElementById('tierIcon').textContent    = tData.icon;
  document.getElementById('tierName').textContent    = tData.name;
  document.getElementById('tierStars').textContent   = '★'.repeat(tier) + '☆'.repeat(6 - tier);
  document.getElementById('tierTagline').textContent = tData.tag;
  const banner = document.getElementById('tierBanner');
  banner.classList.remove('revealed');
  requestAnimationFrame(() => banner.classList.add('revealed'));

  // 사주 기둥
  const pillarsRow = document.getElementById('pillarsRow');
  pillarsRow.innerHTML = '';
  const pillars = [
    { label:'년주', data: saJu.year },
    { label:'월주', data: saJu.month },
    { label:'일주', data: saJu.day },
  ];
  if (saJu.hour) pillars.push({ label:'시주', data: saJu.hour });

  pillars.forEach(({ label, data }) => {
    const box = document.createElement('div');
    box.className = 'pillar-box';
    box.innerHTML = `
      <div class="pillar-label">${label}</div>
      <div class="pillar-char">${data.char}</div>
      <div class="pillar-kr">${data.kr}</div>`;
    pillarsRow.appendChild(box);
  });

  // 오행 바
  const ohaengBar = document.getElementById('ohaengBar');
  ohaengBar.innerHTML = '';
  const order = ['목','화','토','금','수'];
  order.forEach(k => {
    const pct = saJu.ohaeng[k] || 0;
    if (pct === 0) return;
    const seg = document.createElement('div');
    seg.className = 'ohaeng-seg';
    seg.style.flex        = pct;
    seg.style.background  = OHAENG_COLOR[k];
    seg.title             = `${k} ${pct}%`;
    ohaengBar.appendChild(seg);
  });

  // 사주 분석 텍스트
  document.getElementById('sajuText').textContent = result.saju_analysis || '';

  // 관상 목록
  const gwansangList = document.getElementById('gwansangList');
  gwansangList.innerHTML = '';
  const g = result.gwansang || {};
  Object.entries(GWANSANG_META).forEach(([key, meta]) => {
    if (!g[key]) return;
    const item = document.createElement('div');
    item.className = 'gwansang-item';
    item.innerHTML = `
      <div class="gwansang-icon">${meta.icon}</div>
      <div class="gwansang-content">
        <div class="gwansang-part">${meta.label}</div>
        <div class="gwansang-text">${g[key]}</div>
      </div>`;
    gwansangList.appendChild(item);
  });

  // 종합 풀이
  document.getElementById('combinedText').textContent = result.combined_reading || '';

  // 스크롤 초기화
  document.querySelector('.result-scroll').scrollTop = 0;
}

// ── 헬퍼 ─────────────────────────────────────────────
function setLoadingText(text) {
  document.getElementById('loadingSub').textContent = text;
}

function getApiKey() {
  return localStorage.getItem('gwansang_apiKey') || '';
}

function loadSettings() {
  // 설정 로드 시 필요한 초기화 처리
}

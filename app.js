// 천명관상 V2 — 개인형 생애 풀이
// 시기의 길흉·주제·변동 신호는 saju.js가 계산하고, AI는 ① 관상 특징 추출 ② 풀이 작성만 맡는다.

const OHAENG_COLOR = { 목:'#4caf50', 화:'#f44336', 토:'#ff9800', 금:'#b0bec5', 수:'#2196f3' };
const MODEL_FACE = 'anthropic/claude-haiku-5.5';
const MODEL_READ = 'anthropic/claude-sonnet-5.5';
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const RESULT_VERSION = 'v2.1';
const HISTORY_KEY = 'gwansang_v2_history';
const FACE_CACHE_KEY = 'gwansang_v2_faces';
const HISTORY_MAX = 10;

// 유년운기(단순화): 얼굴 부위 ↔ 나이대
const FACE_REGIONS = [
  { key:'forehead', label:'이마',    from:15, to:30 },
  { key:'eyes',     label:'눈·눈썹', from:31, to:40 },
  { key:'nose',     label:'코·광대', from:41, to:50 },
  { key:'mouth',    label:'인중·입', from:51, to:60 },
  { key:'chin',     label:'턱',      from:61, to:120 },
];
const DECISION_META = [
  { key:'job',      label:'이직·직업' },
  { key:'move',     label:'이사·이동' },
  { key:'marriage', label:'결혼·연애' },
  { key:'money',    label:'재물·투자' },
];
const BANNED = /(수명|장수|임종|사망|죽음|요절|단명|세상을\s*떠|생을\s*마감|숨을\s*거|오래\s*살|명이\s*길)/;

// ── 상태 ─────────────────────────────────────────────
const state = {
  gender: 'male', year: null, month: null, day: null, sijinIdx: -1,
  photoFile: null, current: null, // current = { key, createdAt, facts, face, reading }
};

// ── 초기화 ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // 이전 버전 HTML이 캐시에서 열린 경우(서비스워커 갱신 전) 한 번만 새로고침
  // 새 서비스워커가 자리 잡은 뒤 새로고침해야 새 HTML이 열린다
  if (!document.getElementById('resultBody')) {
    let done = false;
    const reload = () => {
      if (done) return; done = true;
      try { if (sessionStorage.getItem('gw_reloaded')) return; sessionStorage.setItem('gw_reloaded', '1'); } catch {}
      location.reload();
    };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', reload);
      navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => {});
      setTimeout(reload, 4000);
    } else reload();
    return;
  }
  initStars();
  initSelects();
  refreshHomeHistory();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
});

function initStars() {
  const canvas = document.getElementById('starCanvas');
  const ctx = canvas.getContext('2d');
  let stars = [];
  function resize() {
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    stars = Array.from({ length: 120 }, () => ({
      x: Math.random() * canvas.width, y: Math.random() * canvas.height,
      r: Math.random() * 1.2 + 0.3, a: Math.random(), speed: Math.random() * 0.008 + 0.003,
    }));
  }
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const t = Date.now() / 1000;
    stars.forEach(s => {
      const alpha = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * s.speed * 20 + s.a * 20));
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(232,213,163,${alpha})`; ctx.fill();
    });
    requestAnimationFrame(draw);
  }
  resize(); draw();
  window.addEventListener('resize', resize);
}

function initSelects() {
  const monthSel = document.getElementById('inputMonth');
  for (let i = 1; i <= 12; i++) monthSel.add(new Option(`${i}월`, i));
  const daySel = document.getElementById('inputDay');
  for (let i = 1; i <= 31; i++) daySel.add(new Option(`${i}일`, i));
  const hourSel = document.getElementById('inputHour');
  SIJIN.forEach((s, idx) => hourSel.add(new Option(`${s.label}  ${s.desc}`, idx)));
}

function showView(id) {
  document.querySelectorAll('.view').forEach(v => { v.classList.remove('active'); v.style.display = 'none'; });
  const next = document.getElementById(id);
  next.style.display = 'flex';
  requestAnimationFrame(() => next.classList.add('active'));
}

// ── DOM 헬퍼 (AI 텍스트는 항상 textContent로) ─────────
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function badge(label) {
  const cls = label === '상승' || label === '유리' ? 'up' : label === '조정' || label === '신중' ? 'down' : 'flat';
  return el('span', `badge badge-${cls}`, label);
}

// ── App 공개 API ──────────────────────────────────────
const App = {
  goHome() { refreshHomeHistory(); showView('view-home'); },
  goInfo() { showView('view-info'); },
  goSettings() { document.getElementById('apiKeyInput').value = getApiKey(); showView('view-settings'); },
  goHistory() { renderHistory(); showView('view-history'); },

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
    const dim = new Date(y, m, 0).getDate();
    if (d > dim) return alert(`${m}월은 ${dim}일까지입니다.`);
    if (new Date(y, m - 1, d) > new Date()) return alert('미래 날짜는 입력할 수 없습니다.');
    Object.assign(state, { year: y, month: m, day: d,
      sijinIdx: parseInt(document.getElementById('inputHour').value) });
    showView('view-photo');
  },

  onPhoto(input) {
    const file = input.files[0];
    if (!file) return;
    state.photoFile = file;
    const reader = new FileReader();
    reader.onload = e => {
      document.getElementById('previewImg').src = e.target.result;
      document.getElementById('faceGuide').style.display = 'none';
      document.getElementById('previewArea').style.display = 'block';
      document.getElementById('btnAnalyze').style.display = 'block';
    };
    reader.readAsDataURL(file);
    input.value = '';
  },

  startAnalysis() { runAnalysis(false); },
  regenerate() {
    if (!state.photoFile) return alert('새로 풀이하려면 처음부터 사진을 다시 선택해주세요.');
    if (confirm('같은 정보로 풀이를 새로 작성합니다. API 요금이 다시 발생합니다. 진행할까요?')) runAnalysis(true);
  },

  saveSettings() {
    const key = document.getElementById('apiKeyInput').value.trim();
    if (!key) return alert('API 키를 입력해주세요.');
    localStorage.setItem('gwansang_apiKey', key);
    alert('저장되었습니다.');
    App.goHome();
  },

  share() {
    const c = state.current; if (!c) return;
    const text = buildShareText(c); // 풀이 전체 공유 (카톡 등 공유 시트)
    if (navigator.share) navigator.share({ title: '천명관상', text }).catch(() => {});
    else copyText(text);
  },

  retry() {
    state.photoFile = null; state.current = null;
    document.getElementById('faceGuide').style.display = 'flex';
    document.getElementById('previewArea').style.display = 'none';
    document.getElementById('btnAnalyze').style.display = 'none';
    App.goHome();
  },

  openHistory(key) {
    const item = loadHistory().find(h => h.key === key);
    if (!item) return;
    state.current = item;
    state.photoFile = null; // 다른 사람의 사진으로 '새로 풀이'가 돌지 않도록
    renderResult(item);
    showView('view-result');
  },
  clearHistory() {
    if (!confirm('저장된 풀이 기록을 모두 삭제할까요? (이 기기에서만 삭제됩니다)')) return;
    localStorage.removeItem(HISTORY_KEY);
    localStorage.removeItem(FACE_CACHE_KEY);
    renderHistory(); refreshHomeHistory();
  },

  scrollTo(id) {
    const target = document.getElementById(id);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
};

// ── 분석 실행 ─────────────────────────────────────────
async function runAnalysis(force) {
  if (!getApiKey()) {
    alert('API 키가 없습니다.\n설정에서 OpenRouter API 키를 입력해주세요.');
    return App.goSettings();
  }
  showView('view-loading');
  let step = '사주계산';
  const stopTicker = startTicker();
  try {
    setLoadingText('사주팔자와 대운을 계산하고 있습니다');
    const input = { year: state.year, month: state.month, day: state.day,
                    sijinIdx: state.sijinIdx, gender: state.gender };
    const facts = Saju.analyze(input, new Date());

    step = '이미지처리';
    setLoadingText('얼굴 사진을 준비하고 있습니다');
    const base64 = await resizeImage(state.photoFile);
    const photoHash = await sha256(await state.photoFile.arrayBuffer());
    const key = await sha256([RESULT_VERSION, input.gender, input.year, input.month, input.day,
                              input.sijinIdx, facts.present.year, photoHash].join('|'));

    const cached = loadHistory().find(h => h.key === key);
    if (cached && !force) {
      try {
        renderResult(cached);
        state.current = cached;
        return showView('view-result');
      } catch (e) {
        console.warn('저장된 풀이를 표시하지 못해 새로 풀이합니다', e);
        removeHistory(key);
      }
    }

    step = '관상분석';
    setLoadingText('관상을 살피고 있습니다');
    const faceCache = loadJSON(FACE_CACHE_KEY, {});
    let face = force ? null : faceCache[photoHash];
    if (!face) {
      face = await callFace(base64);
      faceCache[photoHash] = face;
      const keys = Object.keys(faceCache);
      if (keys.length > HISTORY_MAX) delete faceCache[keys[0]];
      saveJSON(FACE_CACHE_KEY, faceCache);
    }
    attachFace(facts, face);

    step = '풀이작성';
    setLoadingText('지나온 길과 다가올 날을 풀어 쓰고 있습니다 (1~2분 소요)');
    const reading = normalizeReading(await callReading(facts, face));

    step = '결과표시';
    const item = { key, createdAt: Date.now(), input, facts, face, reading,
                   label: `${input.year}.${input.month}.${input.day} · ${input.gender === 'male' ? '남' : '여'}` };
    renderResult(item);          // 화면 표시가 성공한 결과만 저장
    saveHistory(item);
    state.current = item;
    showView('view-result');
  } catch (e) {
    console.error(e);
    showView('view-photo');
    alert('[단계:' + step + ']\n' + (e.message || String(e)));
  } finally {
    stopTicker();
  }
}

function startTicker() {
  const lines = ['오행의 균형을 살피는 중', '대운의 흐름을 따라가는 중', '올해의 기운을 읽는 중',
                 '다가올 3년을 내다보는 중', '생애의 그림을 그리는 중'];
  let i = 0;
  const id = setInterval(() => {
    const sub = document.getElementById('loadingHint');
    if (sub) sub.textContent = lines[i++ % lines.length];
  }, 6000);
  return () => { clearInterval(id); const sub = document.getElementById('loadingHint'); if (sub) sub.textContent = ''; };
}

// 관상 부위를 시기(나이 구간)에 붙인다
function attachFace(facts, face) {
  const regionsFor = (from, to) => FACE_REGIONS
    .filter(r => r.to >= from && r.from <= to && face.regions?.[r.key])
    .map(r => ({ part: r.label, ages: `${r.from}~${r.to > 100 ? '' : r.to}세`,
                 feature: face.regions[r.key].feature, strength: face.regions[r.key].strength }));
  facts.past.forEach(p => { p.face = regionsFor(p.startAge, p.endAge); });
  facts.far.forEach(p => { p.face = regionsFor(p.startAge, p.endAge); });
  facts.present.face = regionsFor(facts.present.age, facts.present.age);
}

// ── AI 호출 ───────────────────────────────────────────
// Claude 5.5 계열은 기본으로 내부 추론(thinking)을 하며, 그 토큰도 max_tokens에 포함된다.
// temperature는 지원하지 않으므로 보내지 않고, 추론 깊이는 effort로 조절한다.
async function callAPI(model, messages, maxTokens, effort) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 300000);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, reasoning: { effort }, stream: false }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`API 오류 (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    let raw = data.choices?.[0]?.message?.content ?? '';
    if (Array.isArray(raw)) raw = raw.find(b => b?.type === 'text')?.text ?? '';
    if (!raw) throw new Error('AI 응답이 비어있습니다. 잠시 후 다시 시도해주세요.');
    if (data.choices?.[0]?.finish_reason === 'length') throw new Error('AI 응답이 길이 제한으로 잘렸습니다. 다시 시도해주세요.');
    if (data.usage) console.info(model, 'usage', data.usage);
    return parseJSON(raw);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('AI 응답 시간이 초과되었습니다. 다시 시도해주세요.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function callFace(base64) {
  const prompt = `당신은 관상학 전문가입니다. 사진 속 얼굴의 부위별 특징을 관찰해 기록하세요.
- 모든 인종의 얼굴을 그 인종 고유의 골격·이목구비 기준으로 동등하게 봅니다.
- 미추(美醜)나 사람의 우열을 평가하지 않습니다. 관찰된 형태와 관상학적 의미만 씁니다.
- strength는 그 부위의 관상학적 기운이 얼마나 뚜렷한지입니다: "강" / "중" / "약".
- 사진이 흐리거나 가려진 부위는 strength를 "중"으로 두고 feature에 "사진상 판별 어려움"이라고 씁니다.
- 수명·장수·건강·질병에 관한 해석은 쓰지 않습니다(인중·턱도 마찬가지). 성품·기질·운의 흐름으로만 씁니다.

반드시 아래 JSON만 반환하세요 (설명·마크다운 금지):
{
  "is_face": true,
  "quality": "good | fair | poor",
  "regions": {
    "forehead": { "feature": "이마 형태와 관상학적 의미 (한 문장)", "strength": "강|중|약" },
    "eyes":     { "feature": "눈·눈썹 (한 문장)", "strength": "강|중|약" },
    "nose":     { "feature": "코·광대 (한 문장)", "strength": "강|중|약" },
    "mouth":    { "feature": "인중·입 (한 문장)", "strength": "강|중|약" },
    "chin":     { "feature": "턱·하관 (한 문장)", "strength": "강|중|약" }
  },
  "overall": "전체 인상과 기질 (한 문장)"
}
사람 얼굴이 아니면 {"is_face": false}만 반환하세요.`;
  const face = await callAPI(MODEL_FACE, [{ role: 'user', content: [
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
    { type: 'text', text: prompt },
  ] }], 4000, 'low');
  if (face.is_face === false) throw new Error('사진에서 얼굴을 찾지 못했습니다. 얼굴이 잘 보이는 정면 사진으로 다시 시도해주세요.');
  if (!face.regions || typeof face.regions !== 'object') throw new Error('관상 분석 결과가 올바르지 않습니다. 다시 시도해주세요.');
  const regions = {};
  FACE_REGIONS.forEach(({ key }) => {
    const r = face.regions[key];
    const feature = typeof r === 'string' ? r : (r && typeof r.feature === 'string' ? r.feature : '');
    if (!feature) return;
    const strength = r && ['강','중','약'].includes(r.strength) ? r.strength : '중';
    regions[key] = { feature, strength };
  });
  return scrubBanned({ quality: String(face.quality || ''), overall: typeof face.overall === 'string' ? face.overall : '', regions });
}

const READING_SYSTEM = `당신은 사주명리와 관상에 밝은 상담가입니다. 한 사람의 과거·현재·미래를 풀어 씁니다.
시기별 길흉·주제·변동 신호는 이미 계산되어 [계산 결과]로 주어집니다. 당신의 일은 그것을 사람의 말로 풀어 쓰는 것입니다.

[반드시 지킬 규칙]
1. [계산 결과]에 없는 길흉을 지어내지 마세요. label(상승/평탄/조정)과 score, themes, flags를 근거로 씁니다.
   score는 "이 사람 인생 안에서의 상대적 위치"입니다(50=평균). 다른 사람과 비교하는 등급이 아닙니다.
2. label이 "조정"이거나 flags가 있는 시기는 반드시 주의할 점을 쓰고, 어떻게 대처하면 좋은지 함께 씁니다.
   "상승" 시기에도 방심하면 안 되는 점을 한 가지는 씁니다. 아첨하지 마세요.
3. 과거(past)는 구체적 사건을 단정하지 마세요. "~한 기운이 강했던 시기", "~했을 가능성이 큽니다"처럼
   시기의 성격과 겪었을 법한 변화의 방향으로 씁니다. 연도·나이는 계산 결과의 것만 씁니다.
4. 결정(decisions)은 "하라/마라"가 아니라 "유리한 시기·신중할 시기"로 씁니다.
   판정값 의미: 유리=그 주제가 들어오고 기운도 좋음 / 움직임 있음=주제는 들어오나 기운은 보통 /
   신중=주제가 들어오지만 기운이 약하거나 충돌이 있음 / 잔잔함=그해에는 그 주제의 움직임이 적음.
5. 수명, 사망·임종 시점, 질병명은 절대 쓰지 마세요. 건강은 생활 습관 수준의 조언만 씁니다.
6. 관상(face)은 보조 근거입니다. 해당 나이대의 부위 특징이 있으면 자연스럽게 한 번씩 연결하세요.
7. 명리 용어(십신·충·합 등)는 쓰되, 바로 뒤에 쉬운 말로 풀어 주세요.
8. 존댓말("~입니다", "~하세요")로 씁니다.

반드시 JSON만 반환하세요 (마크다운·설명 금지).`;

function readingPrompt(facts, face) {
  const slim = JSON.parse(JSON.stringify(facts));
  const strip = o => { delete o.startAge; delete o.endAge; return o; };
  slim.past.forEach(strip); slim.far.forEach(strip);
  slim.daeun = slim.daeun.list.map(d => `${d.ages} ${d.ganji} ${d.label}(${d.score})`).join(' / ');
  return `[계산 결과]
${JSON.stringify(slim)}

[관상 전체 인상] ${face.overall || ''} (사진 품질: ${face.quality || '알 수 없음'})

[출력 형식] — 풀이를 먼저, 요약(headline)은 맨 마지막에 씁니다.
{
  "past": {
    "periods": [ { "range": "past 항목의 range 그대로", "title": "그 시기를 한마디로 (10자 내외)", "text": "2~3문장" } ],
    "summary": "지금까지의 삶을 관통하는 흐름 (2~3문장)"
  },
  "present": {
    "overview": "올해(${facts.present.year}년 ${facts.present.ganji})의 전체 기운 (3~4문장)",
    "areas": { "work": "일·직업 (1~2문장)", "money": "재물 (1~2문장)", "relationship": "관계·인연 (1~2문장)", "health_habit": "몸과 생활 습관 (1문장)" },
    "months": "좋은 달과 조심할 달을 어떻게 쓰면 좋은지 (1~2문장)"
  },
  "future_near": {
    "years": [ { "year": 연도숫자, "keyword": "그해 키워드 (6자 내외)", "text": "3문장" } ],
    "decisions": { "job": "3년 중 언제가 유리하고 언제 신중할지 (2문장)", "move": "…", "marriage": "…", "money": "…" }
  },
  "future_far": {
    "phases": [ { "range": "far 대운들을 2~3개 구간으로 묶은 나이 범위", "text": "3문장" } ],
    "life_portrait": "이 사람이 생애를 어떤 모습으로 정리할지, 무엇을 이루어 가는 사람인지 (4~6문장)"
  },
  "headline": "이 사람의 천명을 한 줄로 (20자 내외)"
}
- past.periods는 [계산 결과]의 past 항목 수(${facts.past.length}개)와 같은 순서·같은 개수로 쓰고, range는 past의 range 문자열을 그대로 복사합니다.
${facts.far.length ? '' : '- [계산 결과]의 far가 비어 있으므로 future_far.phases는 빈 배열 []로 두고, life_portrait만 지나온 흐름을 바탕으로 씁니다.\n'}
- future_near.years는 ${facts.near.map(n => n.year).join(', ')} 세 해입니다.`;
}

async function callReading(facts, face) {
  const messages = [
    { role: 'system', content: READING_SYSTEM },
    { role: 'user', content: readingPrompt(facts, face) },
  ];
  let reading = await callAPI(MODEL_READ, messages, 16000, 'medium');
  if (BANNED.test(JSON.stringify(reading))) {
    messages.push({ role: 'assistant', content: JSON.stringify(reading) },
                  { role: 'user', content: '규칙 5 위반 표현(수명·사망·임종 등)이 있습니다. 해당 표현을 빼고 같은 JSON 형식으로 다시 쓰세요.' });
    try { reading = await callAPI(MODEL_READ, messages, 16000, 'medium'); }
    catch (e) { console.warn('재요청 실패 — 첫 응답에서 금지 표현만 제거', e); }
  }
  return scrubBanned(reading);
}

// 재요청 후에도 남은 금지 표현은 해당 문장째 제거
function scrubBanned(obj) {
  if (typeof obj === 'string') {
    if (!BANNED.test(obj)) return obj;
    return (obj.match(/[^.!?。]+[.!?。]?\s*/g) || []).filter(s => !BANNED.test(s)).join('').trim();
  }
  if (Array.isArray(obj)) return obj.map(scrubBanned);
  if (obj && typeof obj === 'object') {
    for (const k in obj) obj[k] = scrubBanned(obj[k]);
  }
  return obj;
}

// AI 응답 모양을 렌더러가 기대하는 형태로 맞춘다 (배열·문자열 보장)
function normalizeReading(r) {
  const str = v => (typeof v === 'string' ? v : v == null ? '' : String(v));
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const arr = v => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
  r = obj(r);
  const past = obj(r.past), present = obj(r.present), near = obj(r.future_near), far = obj(r.future_far);
  const areas = obj(present.areas), dec = obj(near.decisions);
  return {
    past: { periods: arr(past.periods).map(p => (typeof p === 'string' ? { text: p } : obj(p)))
                       .map(p => ({ range: str(p.range), title: str(p.title), text: str(p.text) })),
            summary: str(past.summary) },
    present: { overview: str(present.overview), months: str(present.months),
               areas: { work: str(areas.work), money: str(areas.money), relationship: str(areas.relationship), health_habit: str(areas.health_habit) } },
    future_near: { years: arr(near.years).map(obj).map(y => ({ year: Number(y.year) || 0, keyword: str(y.keyword), text: str(y.text) })),
                   decisions: { job: str(dec.job), move: str(dec.move), marriage: str(dec.marriage), money: str(dec.money) } },
    future_far: { phases: arr(far.phases).map(p => (typeof p === 'string' ? { text: p } : obj(p)))
                            .map(p => ({ range: str(p.range), text: str(p.text) })),
                  life_portrait: str(far.life_portrait) },
    headline: str(r.headline),
  };
}

function parseJSON(raw) {
  const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('AI 응답에서 JSON을 찾을 수 없습니다.');
  try { return JSON.parse(raw.slice(s, e + 1)); }
  catch { throw new Error('AI 응답 파싱 실패: ' + raw.slice(0, 100)); }
}

// ── 결과 렌더링 ───────────────────────────────────────
function renderResult(item) {
  const { facts, face } = item;
  const r = normalizeReading(item.reading);
  const root = document.getElementById('resultBody');
  root.textContent = '';

  // 헤더
  const head = el('div', 'result-head');
  head.append(el('div', 'result-year', `${facts.present.year} ${facts.present.ganji}년 · 만 ${facts.age}세`),
              el('h2', 'result-headline', r.headline || '당신의 천명'));
  const chips = el('div', 'chip-row');
  [['sec-past','지나온 길'],['sec-present','올해'],['sec-near','다가올 3년'],['sec-far','생애의 그림']].forEach(([id, label]) => {
    const b = el('button', 'chip', label); b.onclick = () => App.scrollTo(id); chips.append(b);
  });
  head.append(chips);
  root.append(head);

  // 사주 원국
  const chartCard = card('☰ 사주 원국');
  const pr = el('div', 'pillars-row');
  [['시주','hour'],['일주','day'],['월주','month'],['년주','year']].forEach(([label, k]) => {
    const box = el('div', 'pillar-box');
    box.append(el('div', 'pillar-label', label),
               el('div', 'pillar-char', facts.chart.pillars[k] || '?'),
               el('div', 'pillar-kr', facts.chart.pillarsKr[k] || '모름'));
    pr.append(box);
  });
  chartCard.append(pr);
  const bar = el('div', 'ohaeng-bar');
  const legend = el('div', 'ohaeng-legend');
  ['목','화','토','금','수'].forEach(k => {
    const pct = facts.chart.ohaeng[k] || 0;
    if (pct > 0) { const seg = el('div', 'ohaeng-seg'); seg.style.flex = pct; seg.style.background = OHAENG_COLOR[k]; bar.append(seg); }
    const lg = el('span', 'lg', `${k} ${pct}%`); lg.style.setProperty('--c', OHAENG_COLOR[k]); legend.append(lg);
  });
  chartCard.append(bar, legend);
  chartCard.append(el('p', 'card-meta',
    `일간 ${facts.chart.dayMaster} · ${facts.chart.strength.label} · 힘이 되는 기운 ${facts.chart.favorable.join('·')}`));
  facts.chart.notes.forEach(n => chartCard.append(el('p', 'card-note', 'ⓘ ' + n)));

  // 대운 띠
  const strip = el('div', 'daeun-strip');
  facts.daeun.list.forEach(d => {
    const cell = el('div', `daeun-cell lv-${d.label}` + (facts.present.daeun && facts.present.daeun.k === d.k ? ' now' : ''));
    cell.append(el('div', 'dc-age', `${d.startAge}세`), el('div', 'dc-ganji', d.ganji), el('div', 'dc-label', d.label));
    strip.append(cell);
  });
  chartCard.append(el('p', 'sub-title', `대운 (${facts.daeun.forward ? '순행' : '역행'} · ${facts.daeun.startAge}세 시작)`), strip);
  root.append(chartCard);

  // 관상 요약
  if (face) {
    const fc = card('◎ 관상');
    if (face.overall) fc.append(el('p', 'card-body', face.overall));
    FACE_REGIONS.forEach(reg => {
      const f = face.regions?.[reg.key]; if (!f) return;
      const row = el('div', 'face-row');
      row.append(el('div', 'face-part', `${reg.label} · ${reg.from}${reg.to > 100 ? '세~' : '~' + reg.to + '세'}`),
                 el('div', 'face-text', `${f.feature} (${f.strength})`));
      fc.append(row);
    });
    root.append(fc);
  }

  // 과거
  const past = section('sec-past', '◐ 지나온 길');
  const periods = r.past?.periods || [];
  facts.past.forEach((p, i) => {
    const rp = periods.find(x => x.range === p.range) || periods[i] || {};
    const item = el('div', 'period' + (p.current ? ' current' : ''));
    const top = el('div', 'period-top');
    top.append(el('span', 'period-range', p.range + (p.current ? ' · 지금' : '')), badge(p.label));
    item.append(top);
    if (rp.title) item.append(el('div', 'period-title', rp.title));
    if (rp.text) item.append(el('p', 'card-body', rp.text));
    past.append(item);
  });
  if (r.past?.summary) past.append(el('p', 'section-summary', r.past.summary));
  root.append(past);

  // 현재
  const pres = section('sec-present', `◉ 올해의 운 · ${facts.present.year} ${facts.present.ganji}`);
  const ptop = el('div', 'period-top');
  ptop.append(el('span', 'period-range', `만 ${facts.age}세 · ${facts.present.daeun ? facts.present.daeun.ganji + ' 대운' : ''}`), badge(facts.present.label));
  pres.append(ptop);
  if (r.present?.overview) pres.append(el('p', 'card-body', r.present.overview));
  const grid = el('div', 'area-grid');
  [['work','일·직업'],['money','재물'],['relationship','관계·인연'],['health_habit','몸과 습관']].forEach(([k, label]) => {
    if (!r.present?.areas?.[k]) return;
    const a = el('div', 'area');
    a.append(el('div', 'area-label', label), el('div', 'area-text', r.present.areas[k]));
    grid.append(a);
  });
  pres.append(grid);
  const months = el('div', 'months');
  if (facts.present.goodMonths.length) months.append(el('div', 'm-good', '좋은 달 · ' + facts.present.goodMonths.join(', ')));
  if (facts.present.cautionMonths.length) months.append(el('div', 'm-caution', '조심할 달 · ' + facts.present.cautionMonths.join(', ')));
  pres.append(months);
  if (r.present?.months) pres.append(el('p', 'card-body small', r.present.months));
  root.append(pres);

  // 미래A
  const near = section('sec-near', '◑ 다가올 3년');
  const ry = r.future_near?.years || [];
  facts.near.forEach(n => {
    const ny = ry.find(y => Number(y.year) === n.year) || {};
    const item = el('div', 'period');
    const top = el('div', 'period-top');
    top.append(el('span', 'period-range', `${n.year} ${n.ganji}년 · 만 ${n.age}세` + (ny.keyword ? ` · ${ny.keyword}` : '')), badge(n.label));
    item.append(top);
    if (ny.text) item.append(el('p', 'card-body', ny.text));
    near.append(item);
  });
  const dt = el('div', 'decision-table');
  DECISION_META.forEach(dm => {
    const row = el('div', 'decision-row');
    const head2 = el('div', 'decision-head');
    head2.append(el('span', 'decision-label', dm.label));
    const marks = el('span', 'decision-marks');
    facts.near.forEach(n => {
      const m = el('span', 'dmark'); m.append(el('span', 'dm-year', String(n.year).slice(2) + '년 '), badge(n.decisions[dm.key])); marks.append(m);
    });
    head2.append(marks);
    row.append(head2);
    const txt = r.future_near?.decisions?.[dm.key];
    if (txt) row.append(el('p', 'card-body small', txt));
    dt.append(row);
  });
  near.append(el('p', 'sub-title', '중요한 결정의 시기'), dt);
  root.append(near);

  // 미래B
  const far = section('sec-far', '○ 생애의 그림');
  (r.future_far?.phases || []).forEach(ph => {
    const item = el('div', 'period');
    item.append(el('div', 'period-range', ph.range || ''));
    if (ph.text) item.append(el('p', 'card-body', ph.text));
    far.append(item);
  });
  if (r.future_far?.life_portrait) {
    const lp = el('div', 'life-portrait');
    lp.append(el('div', 'lp-title', '✦ 생애를 정리하며'), el('p', 'card-body', r.future_far.life_portrait));
    far.append(lp);
  }
  root.append(far);

  root.append(el('p', 'disclaimer',
    'ⓘ 이 풀이는 전통 명리·관상 이론을 단순화한 계산에 근거한 참고용 해석입니다. 중요한 결정은 본인의 판단으로 하세요.'));

  document.querySelector('#view-result .result-scroll').scrollTop = 0;
}

function card(title) { const c = el('div', 'result-card'); c.append(el('div', 'card-title', title)); return c; }
function section(id, title) { const c = card(title); c.id = id; return c; }

// ── 공유 텍스트 ───────────────────────────────────────
function buildShareText(item) {
  const { facts } = item;
  const r = normalizeReading(item.reading);
  const lines = [`[천명관상] ${r.headline || ''}`,
    `사주 ${['year','month','day','hour'].map(k => facts.chart.pillars[k]).filter(Boolean).join(' ')} · ${facts.chart.strength.label}`, '',
    '◐ 지나온 길'];
  facts.past.forEach((p, i) => { const rp = r.past.periods.find(x => x.range === p.range) || r.past.periods[i] || {}; lines.push(`· ${p.range} [${p.label}] ${rp.title || ''}`, rp.text || ''); });
  if (r.past?.summary) lines.push(r.past.summary);
  lines.push('', `◉ 올해 ${facts.present.year} ${facts.present.ganji}년 [${facts.present.label}]`, r.present?.overview || '');
  const a = r.present?.areas || {};
  lines.push(`일: ${a.work || ''}`, `재물: ${a.money || ''}`, `관계: ${a.relationship || ''}`, `몸: ${a.health_habit || ''}`);
  lines.push(`좋은 달: ${facts.present.goodMonths.join(', ')} / 조심할 달: ${facts.present.cautionMonths.join(', ')}`);
  lines.push('', '◑ 다가올 3년');
  facts.near.forEach(n => { const y = (r.future_near?.years || []).find(x => Number(x.year) === n.year) || {}; lines.push(`· ${n.year} [${n.label}] ${y.keyword || ''}`, y.text || ''); });
  DECISION_META.forEach(d => lines.push(`${d.label}: ${r.future_near?.decisions?.[d.key] || ''}`));
  lines.push('', '○ 생애의 그림');
  (r.future_far?.phases || []).forEach(ph => lines.push(`· ${ph.range}`, ph.text || ''));
  lines.push(r.future_far?.life_portrait || '', '', '※ 참고용 해석입니다.');
  return lines.join('\n');
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => alert('클립보드에 복사되었습니다.'))
    .catch(() => alert('복사에 실패했습니다.'));
}

// ── 기록 ─────────────────────────────────────────────
function loadJSON(k, def) { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } }
function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
function loadHistory() { const h = loadJSON(HISTORY_KEY, []); return Array.isArray(h) ? h : []; }
function saveHistory(item) {
  let h = loadHistory().filter(x => x.key !== item.key);
  h.unshift(item);
  h = h.slice(0, HISTORY_MAX);
  while (h.length && !saveJSON(HISTORY_KEY, h)) h.pop(); // 용량 초과 시 오래된 것부터 정리
}
function removeHistory(key) { saveJSON(HISTORY_KEY, loadHistory().filter(x => x.key !== key)); }
function refreshHomeHistory() {
  const n = loadHistory().length;
  const btn = document.getElementById('btnHistory');
  if (!btn) return;
  btn.style.display = n ? 'block' : 'none';
  btn.textContent = `지난 풀이 보기 (${n})`;
}
function renderHistory() {
  const list = document.getElementById('historyList');
  list.textContent = '';
  const h = loadHistory();
  if (!h.length) { list.append(el('p', 'input-hint', '저장된 풀이가 없습니다.')); return; }
  h.forEach(item => {
    const row = el('button', 'history-row');
    const d = new Date(item.createdAt);
    row.append(el('div', 'hr-title', item.reading?.headline || '천명 풀이'),
               el('div', 'hr-meta', `${item.label} · ${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} 풀이`));
    row.onclick = () => App.openHistory(item.key);
    list.append(row);
  });
}

// ── 이미지·해시 ───────────────────────────────────────
function resizeImage(file, maxSize = 800, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('사진 파일을 읽지 못했습니다.'));
    reader.onload = e => {
      const img = new Image();
      img.onerror = () => reject(new Error('이 사진 형식은 열 수 없습니다. 다른 사진(JPG/PNG)으로 시도해주세요.'));
      img.onload = () => {
        const ratio = Math.min(maxSize / img.width, maxSize / img.height, 1);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function sha256(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  if (window.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 5381; for (let i = 0; i < bytes.length; i++) h = ((h << 5) + h + bytes[i]) | 0;
  return 'djb2-' + (h >>> 0).toString(16) + '-' + bytes.length;
}

function setLoadingText(text) { document.getElementById('loadingSub').textContent = text; }
function getApiKey() { return localStorage.getItem('gwansang_apiKey') || ''; }

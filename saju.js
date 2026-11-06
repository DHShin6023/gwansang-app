// 천명관상 사주 엔진 V2
// - 절기(태양 황경) 기준 년주·월주, 지장간 포함 오행, 신강/신약(억부 간이),
//   대운·세운·월운, 십신, 합·충·형, 역마·도화·화개를 계산한다.
// - 시기의 좋고 나쁨(점수)과 주제·변동 신호는 여기서 결정한다. AI는 이것을 근거로 풀이만 쓴다.
// - 명리 이론의 단순화가 포함되어 있다(용신=억부법만, 격국·조후 미반영).
(function (root) {
'use strict';

const STEMS       = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
const BRANCHES    = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
const STEMS_KR    = ['갑','을','병','정','무','기','경','신','임','계'];
const BRANCHES_KR = ['자','축','인','묘','진','사','오','미','신','유','술','해'];
const ELEMENTS    = ['목','화','토','금','수'];

// 지지 본기(本氣) 천간
const BRANCH_MAIN = [9,5,0,1,4,2,3,5,6,7,4,8];
// 지장간 [천간, 비중] (여기·중기·본기를 단순화한 비중)
const HIDDEN = [
  [[9,1]],
  [[5,.6],[9,.25],[7,.15]],
  [[0,.6],[2,.25],[4,.15]],
  [[1,1]],
  [[4,.6],[1,.25],[9,.15]],
  [[2,.6],[6,.25],[4,.15]],
  [[3,.7],[5,.3]],
  [[5,.6],[3,.25],[1,.15]],
  [[6,.6],[8,.25],[4,.15]],
  [[7,1]],
  [[4,.6],[7,.25],[3,.15]],
  [[8,.7],[0,.3]],
];

// 시진: 자시를 새벽(당일)·밤(다음 날 일주)으로 나눈 13개. mid = 계산에 쓰는 대표 시각(시)
const SIJIN = [
  { label:'자시(子時) · 새벽', desc:'자정 ~ 새벽 1시',     branch: 0, mid: 0.5 },
  { label:'축시(丑時)',        desc:'새벽 1시 ~ 3시',      branch: 1, mid: 2 },
  { label:'인시(寅時)',        desc:'새벽 3시 ~ 5시',      branch: 2, mid: 4 },
  { label:'묘시(卯時)',        desc:'새벽 5시 ~ 7시',      branch: 3, mid: 6 },
  { label:'진시(辰時)',        desc:'아침 7시 ~ 9시',      branch: 4, mid: 8 },
  { label:'사시(巳時)',        desc:'오전 9시 ~ 11시',     branch: 5, mid: 10 },
  { label:'오시(午時)',        desc:'오전 11시 ~ 오후 1시', branch: 6, mid: 12 },
  { label:'미시(未時)',        desc:'오후 1시 ~ 3시',      branch: 7, mid: 14 },
  { label:'신시(申時)',        desc:'오후 3시 ~ 5시',      branch: 8, mid: 16 },
  { label:'유시(酉時)',        desc:'오후 5시 ~ 7시',      branch: 9, mid: 18 },
  { label:'술시(戌時)',        desc:'저녁 7시 ~ 9시',      branch:10, mid: 20 },
  { label:'해시(亥時)',        desc:'밤 9시 ~ 11시',       branch:11, mid: 22 },
  { label:'자시(子時) · 밤',    desc:'밤 11시 ~ 자정 (생일 당일 밤)', branch: 0, mid: 23.5, nextDay: true },
];

const DAY_MS = 86400000;
const mod = (n, m) => ((n % m) + m) % m;

// ── 천문: 태양 겉보기 황경 (Meeus 저정밀식, 오차 수 분) ─────────
function sunLongitude(ms) {
  const jd = ms / DAY_MS + 2440587.5 + 69 / 86400; // ΔT 근사
  const T  = (jd - 2451545.0) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M  = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * Math.PI / 180;
  const C  = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M)
           + (0.019993 - 0.000101 * T) * Math.sin(2 * M)
           + 0.000289 * Math.sin(3 * M);
  const omega = (125.04 - 1934.136 * T) * Math.PI / 180;
  return mod(L0 + C - 0.00569 - 0.00478 * Math.sin(omega), 360);
}

// 절(節) 구간 번호: 寅월=0 … 丑월=11 (경계는 황경 315°+30°k)
function monthSegment(ms) {
  return Math.floor(mod(sunLongitude(ms) - 315, 360) / 30);
}

// ms 이후(dir=1) 또는 이전(dir=-1)의 가장 가까운 절입 시각
function findTerm(ms, dir) {
  const seg0 = monthSegment(ms);
  let a = ms, b = ms;
  for (let i = 0; i < 40; i++) {
    b = a + dir * DAY_MS;
    if (monthSegment(b) !== seg0) break;
    a = b;
  }
  // a: 같은 구간, b: 다른 구간 → 이분 탐색(1분 정밀도)
  while (Math.abs(b - a) > 60000) {
    const m = (a + b) / 2;
    if (monthSegment(m) === seg0) a = m; else b = m;
  }
  return dir > 0 ? b : a;
}

// 한국 시각(KST, UTC+9) → UTC ms
function kstMs(y, m, d, hour) {
  return Date.UTC(y, m - 1, d) + (hour - 9) * 3600000;
}
function msToKstDate(ms) {
  const t = new Date(ms + 9 * 3600000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(),
           hh: t.getUTCHours(), mi: t.getUTCMinutes() };
}

// ── 간지 기본 ─────────────────────────────────────────
const idx60 = (s, b) => mod(6 * s - 5 * b, 60);
function pillar(i60) {
  const s = mod(i60, 10), b = mod(i60, 12);
  return { i60: mod(i60, 60), stem: s, branch: b,
           char: STEMS[s] + BRANCHES[b], kr: STEMS_KR[s] + BRANCHES_KR[b] };
}
const pillarSB = (s, b) => pillar(idx60(s, b));
const stemElem = s => Math.floor(s / 2);
const stemYang = s => s % 2 === 0;

function yearPillarOf(sajuYear) { return pillar(mod(sajuYear - 4, 60)); }
function monthPillarOf(sajuYear, seg) {
  const yStem = mod(sajuYear - 4, 10);
  const startStem = mod((yStem % 5) * 2 + 2, 10); // 甲己→丙寅 …
  return pillarSB(mod(startStem + seg, 10), mod(2 + seg, 12));
}
function dayPillarOf(y, m, d) {
  const diff = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1900, 0, 1)) / DAY_MS);
  return pillar(10 + diff); // 1900-01-01 = 甲戌
}
function hourPillarOf(dayStem, branch) {
  return pillarSB(mod((dayStem % 5) * 2 + branch, 10), branch);
}

// 어떤 시각이 속한 사주 년·월
function sajuYearMonth(ms) {
  const seg = monthSegment(ms);
  const k = msToKstDate(ms);
  const sajuYear = (k.m <= 2 && seg >= 10) ? k.y - 1 : k.y;
  return { sajuYear, seg };
}

// ── 십신 ──────────────────────────────────────────────
const SIPSIN_NAMES = [['비견','겁재'],['식신','상관'],['편재','정재'],['편관','정관'],['편인','정인']];
const CATEGORY = ['비겁','식상','재성','관성','인성'];
function relOf(dayStem, stem) { return mod(stemElem(stem) - stemElem(dayStem), 5); }
function sipsin(dayStem, stem) {
  const rel = relOf(dayStem, stem);
  return SIPSIN_NAMES[rel][stemYang(stem) === stemYang(dayStem) ? 0 : 1];
}
function categoryOf(dayStem, stem) { return CATEGORY[relOf(dayStem, stem)]; }

// ── 지지·천간 관계 ────────────────────────────────────
const YUKHAP = new Set(['0-1','2-11','3-10','4-9','5-8','6-7']);
const HYEONG = new Set(['0-3','2-5','5-8','1-10','7-10','1-7']);
const SELF_HYEONG = new Set([4, 6, 9, 11]);
const pairKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const isChung  = (a, b) => mod(a - b, 12) === 6;
const isYukhap = (a, b) => YUKHAP.has(pairKey(a, b));
const isHyeong = (a, b) => (a === b ? SELF_HYEONG.has(a) : HYEONG.has(pairKey(a, b)));
const isStemHap   = (a, b) => Math.abs(a - b) === 5;
const isStemChung = (a, b) => Math.abs(a - b) === 6 && Math.min(a, b) < 4;

// 신살 (삼합 그룹 기준)
function samhapGroup(b) {
  if ([8,0,4].includes(b)) return 0;  // 申子辰
  if ([2,6,10].includes(b)) return 1; // 寅午戌
  if ([5,9,1].includes(b)) return 2;  // 巳酉丑
  return 3;                           // 亥卯未
}
const YEOKMA = [2, 8, 11, 5];
const DOHWA  = [9, 3, 6, 0];
const HWAGAE = [4, 10, 1, 7];

// ── 원국 계산 ─────────────────────────────────────────
function calcChart(input) {
  const { year, month, day, gender } = input;
  const sj = input.sijinIdx >= 0 ? SIJIN[input.sijinIdx] : null;
  const hour = sj ? sj.mid : 12;
  const birthMs = kstMs(year, month, day, hour);
  const { sajuYear, seg } = sajuYearMonth(birthMs);

  const yP = yearPillarOf(sajuYear);
  const mP = monthPillarOf(sajuYear, seg);
  let dY = year, dM = month, dD = day;
  if (sj && sj.nextDay) {
    const t = new Date(Date.UTC(year, month - 1, day) + DAY_MS);
    dY = t.getUTCFullYear(); dM = t.getUTCMonth() + 1; dD = t.getUTCDate();
  }
  const dP = dayPillarOf(dY, dM, dD);
  const hP = sj ? hourPillarOf(dP.stem, sj.branch) : null;
  const dm = dP.stem;

  // 오행 분포 (천간 1 + 지지는 지장간 비중대로 1을 나눔)
  const elemW = [0,0,0,0,0];
  [yP, mP, dP, hP].filter(Boolean).forEach(p => {
    elemW[stemElem(p.stem)] += 1;
    HIDDEN[p.branch].forEach(([s, w]) => { elemW[stemElem(s)] += w; });
  });
  const elemTotal = elemW.reduce((a, b) => a + b, 0);
  const ohaeng = {};
  ELEMENTS.forEach((e, i) => { ohaeng[e] = Math.round(elemW[i] / elemTotal * 100); });

  // 신강/신약: 위치 가중(월지 3, 일지 1.5)
  let support = 0, total = 0;
  const addStem = (s, w) => { total += w; const r = relOf(dm, s); if (r === 0 || r === 4) support += w; };
  addStem(yP.stem, 1); addStem(mP.stem, 1); if (hP) addStem(hP.stem, 1);
  const addBranch = (b, w) => HIDDEN[b].forEach(([s, hw]) => addStem(s, w * hw));
  addBranch(yP.branch, 1); addBranch(mP.branch, 3); addBranch(dP.branch, 1.5); if (hP) addBranch(hP.branch, 1);
  const ratio = support / total;
  // 경계값은 이론상 0.5가 아니라 모집단 중앙값(≈0.40)에 맞춘다.
  // 돕는 오행이 5개 중 2개(비겁·인성)뿐이라 0.5로 자르면 77%가 신약으로 쏠림(시뮬레이션 확인).
  const strong = ratio >= 0.40;
  const strengthLabel = ratio >= 0.52 ? '신강' : ratio >= 0.40 ? '약간 신강'
                      : ratio >= 0.28 ? '약간 신약' : '신약';
  // 희신(+1)/기신(-1): rel(0비겁 1식상 2재성 3관성 4인성)
  const favorRel = [0,1,2,3,4].map(r => ((r === 0 || r === 4) ? (strong ? -1 : 1) : (strong ? 1 : -1)));
  const favorable   = favorRel.map((f, r) => f > 0 ? ELEMENTS[mod(stemElem(dm) + r, 5)] : null).filter(Boolean);
  const unfavorable = favorRel.map((f, r) => f < 0 ? ELEMENTS[mod(stemElem(dm) + r, 5)] : null).filter(Boolean);

  // 절기 경계일 안내: 출생일에 절입이 있으면 시진 단위로는 월주가 틀릴 수 있음
  const notes = [];
  const dayStart = kstMs(year, month, day, 0), dayEnd = dayStart + DAY_MS;
  const termNext = findTerm(dayStart, 1);
  if (termNext < dayEnd) {
    const k = msToKstDate(termNext);
    notes.push(`출생일(${month}/${day})에 절기가 바뀝니다(${String(k.hh).padStart(2,'0')}:${String(k.mi).padStart(2,'0')}경). 태어난 시각에 따라 월주${monthSegment(termNext) === 0 ? '·년주' : ''}가 달라질 수 있습니다.`);
  }
  if ((year >= 1948 && year <= 1961) || year === 1987 || year === 1988)
    notes.push('출생 연도에 표준시·서머타임이 지금과 달랐습니다. 시진 경계(정시 무렵) 출생이면 시주가 한 칸 다를 수 있습니다.');
  if (!sj) notes.push('태어난 시를 모르는 상태로 계산했습니다. 시주와 대운 시작 나이는 근사치입니다.');

  const chart = {
    input: { year, month, day, gender, sijinIdx: input.sijinIdx },
    birthMs, sajuYear,
    pillars: { year: yP, month: mP, day: dP, hour: hP },
    dayMaster: dm,
    dayMasterText: `${STEMS[dm]}(${STEMS_KR[dm]}${ELEMENTS[stemElem(dm)]})`,
    ohaeng,
    strength: { ratio: Math.round(ratio * 100) / 100, label: strengthLabel },
    favorRel, favorable, unfavorable,
    shinsal: {
      yeokma: new Set([YEOKMA[samhapGroup(dP.branch)], YEOKMA[samhapGroup(yP.branch)]]),
      dohwa:  new Set([DOHWA[samhapGroup(dP.branch)],  DOHWA[samhapGroup(yP.branch)]]),
      hwagae: new Set([HWAGAE[samhapGroup(dP.branch)], HWAGAE[samhapGroup(yP.branch)]]),
    },
    notes,
  };
  // 개인 기준선: 60갑자 전체에 대한 이 사람의 점수 평균·표준편차.
  // 점수는 "이 사람 인생 안에서 상대적으로 좋은/힘든 시기"를 뜻한다(사람끼리의 우열이 아님).
  const raws = [];
  for (let i = 0; i < 60; i++) raws.push(rawScore(chart, pillar(i)));
  const mean = raws.reduce((a, b) => a + b, 0) / 60;
  const sd = Math.sqrt(raws.reduce((a, b) => a + (b - mean) ** 2, 0) / 60) || 1;
  chart.baseline = { mean, sd };
  return chart;
}

// ── 시기(간지 하나)의 신호 ────────────────────────────
function themesOf(chart, cats, names) {
  const male = chart.input.gender === 'male';
  const t = [];
  const add = x => { if (!t.includes(x)) t.push(x); };
  cats.forEach((c, i) => {
    if (c === '비겁') add(names[i] === '겁재' ? '경쟁·지출' : '자립·동료');
    if (c === '식상') add(names[i] === '상관' ? '변화·자기주장' : '표현·활동');
    if (c === '재성') { add('재물·성과'); if (male) add('이성 인연'); }
    if (c === '관성') { add('직장·책임·명예'); if (!male) add('이성 인연'); }
    if (c === '인성') add('학업·문서·도움');
  });
  return t;
}

function rawScore(chart, p) {
  const f = chart.favorRel, dm = chart.dayMaster;
  const sStem = f[relOf(dm, p.stem)];
  let sBranch = 0;
  HIDDEN[p.branch].forEach(([s, w]) => { sBranch += w * f[relOf(dm, s)]; });
  let v = 0.45 * sStem + 0.55 * sBranch;
  const P = chart.pillars;
  if (isChung(p.branch, P.day.branch))   v -= 0.25;
  if (isChung(p.branch, P.month.branch)) v -= 0.2;
  if (isChung(p.branch, P.year.branch))  v -= 0.1;
  if (isHyeong(p.branch, P.day.branch))  v -= 0.1;
  if (isYukhap(p.branch, P.day.branch))  v += 0.1;
  if (isStemChung(p.stem, dm)) v -= 0.1;
  if (isStemHap(p.stem, dm))   v += 0.05;
  return v;
}
// 개인 기준선으로 표준화한 점수(z). 기준선 계산 전에는 원점수 그대로.
function zScore(chart, p) {
  const v = rawScore(chart, p);
  return chart.baseline ? (v - chart.baseline.mean) / chart.baseline.sd : v;
}
// 여러 z를 가중합한 뒤 분산을 다시 1로 맞춘다
function blend(pairs) {
  const s = pairs.reduce((a, [z, w]) => a + z * w, 0);
  return s / Math.sqrt(pairs.reduce((a, [, w]) => a + w * w, 0));
}
const toScore = z => Math.max(5, Math.min(95, Math.round(50 + 15 * z)));
const labelOf = s => (s >= 58 ? '상승' : s <= 42 ? '조정' : '평탄');

function signalsOf(chart, p) {
  const dm = chart.dayMaster, P = chart.pillars;
  const names = [sipsin(dm, p.stem), sipsin(dm, BRANCH_MAIN[p.branch])];
  const cats  = [categoryOf(dm, p.stem), categoryOf(dm, BRANCH_MAIN[p.branch])];
  const flags = [];
  if (isChung(p.branch, P.day.branch))   flags.push('일지 충: 생활 기반·가까운 관계의 변동');
  if (isChung(p.branch, P.month.branch)) flags.push('월지 충: 일·사회 환경의 변동');
  if (isChung(p.branch, P.year.branch))  flags.push('년지 충: 집안·뿌리 쪽의 변동');
  if (isHyeong(p.branch, P.day.branch))  flags.push('형: 마찰·조정이 필요한 일');
  if (isYukhap(p.branch, P.day.branch))  flags.push('일지 합: 인연·협력이 맺어지기 쉬움');
  if (isStemHap(p.stem, dm))   flags.push('일간 합: 끌리는 인연·제안');
  if (isStemChung(p.stem, dm)) flags.push('일간 충: 자신을 흔드는 외부 압력');
  if (chart.shinsal.yeokma.has(p.branch)) flags.push('역마: 이동·출장·이사');
  if (chart.shinsal.dohwa.has(p.branch))  flags.push('도화: 매력·인기·이성 인연');
  if (chart.shinsal.hwagae.has(p.branch)) flags.push('화개: 공부·내면·종교·예술');
  return { names, cats, themes: themesOf(chart, cats, names), flags };
}

function decisionsOf(chart, p, sig, score) {
  const male = chart.input.gender === 'male';
  const P = chart.pillars;
  const has = c => sig.cats.includes(c);
  const verdict = (active, extraCaution) => {
    if (!active) return '잔잔함';
    if (extraCaution || score < 45) return '신중';
    if (score >= 55) return '유리';
    return '움직임 있음';
  };
  const chungDay = isChung(p.branch, P.day.branch), chungYear = isChung(p.branch, P.year.branch);
  return {
    job:      verdict(has('관성') || sig.names.includes('상관') || isChung(p.branch, P.month.branch)),
    move:     verdict(chart.shinsal.yeokma.has(p.branch) || chungDay || chungYear || has('인성')),
    marriage: verdict(has(male ? '재성' : '관성') || chart.shinsal.dohwa.has(p.branch)
                      || isYukhap(p.branch, P.day.branch) || isStemHap(p.stem, chart.dayMaster),
                      chungDay),
    money:    verdict(has('재성') || sig.names.includes('겁재'), sig.names.includes('겁재')),
  };
}

function describe(chart, p, raw) {
  const score = toScore(raw);
  const sig = signalsOf(chart, p);
  return {
    ganji: p.char, ganjiKr: p.kr,
    sipsin: { stem: sig.names[0], branch: sig.names[1] },
    themes: sig.themes, flags: sig.flags,
    score, label: labelOf(score),
    _sig: sig,
  };
}

// ── 대운 ──────────────────────────────────────────────
function calcDaeun(chart) {
  const male = chart.input.gender === 'male';
  const forward = stemYang(chart.pillars.year.stem) === male; // 양남·음녀 순행
  const term = findTerm(chart.birthMs, forward ? 1 : -1);
  const days = Math.abs(term - chart.birthMs) / DAY_MS;
  const startAge = Math.max(1, Math.round(days / 3));
  const list = [];
  for (let k = 1; k <= 10; k++) {
    const p = pillar(chart.pillars.month.i60 + (forward ? k : -k));
    const sAge = startAge + 10 * (k - 1);
    list.push({ k, startAge: sAge, endAge: sAge + 9,
                startYear: chart.input.year + sAge, endYear: chart.input.year + sAge + 9,
                pillar: p, raw: zScore(chart, p) });
  }
  return { forward, startAge, list };
}
function daeunAtAge(daeun, age) {
  return daeun.list.find(d => age >= d.startAge && age <= d.endAge) || null;
}

// ── 월운 (사주년 Y의 寅월~丑월) ───────────────────────
function monthsOfYear(Y) {
  const out = [];
  let t = findTerm(kstMs(Y, 1, 25, 0), 1); // 입춘
  for (let seg = 0; seg < 12; seg++) {
    const next = findTerm(t + DAY_MS, 1);
    out.push({ seg, start: t, end: next, pillar: monthPillarOf(Y, seg) });
    t = next;
  }
  return out;
}

// ── 메인: 생애 풀이용 사실 묶음 ───────────────────────
function analyze(input, now) {
  now = now || new Date();
  const chart = calcChart(input);
  const daeun = calcDaeun(chart);
  const nowMs = now.getTime();
  const kNow = msToKstDate(nowMs);
  const { year: by, month: bm, day: bd } = chart.input;
  const age = kNow.y - by - ((kNow.m < bm || (kNow.m === bm && kNow.d < bd)) ? 1 : 0);
  const ageInYear = Y => Y - by; // 그해 생일 이후 만 나이

  const daeunDesc = d => d ? { k: d.k, ganji: d.pillar.char, ganjiKr: d.pillar.kr,
                               ages: `${d.startAge}~${d.endAge}세`, years: `${d.startYear}~${d.endYear}` } : null;
  const daeunRawAt = a => { const d = daeunAtAge(daeun, a); return d ? d.raw : zScore(chart, chart.pillars.month); };

  // 연도(세운) 분석
  function yearInfo(Y) {
    const p = yearPillarOf(Y);
    const a = ageInYear(Y);
    const raw = blend([[zScore(chart, p), 0.6], [daeunRawAt(a), 0.4]]);
    const info = describe(chart, p, raw);
    const months = monthsOfYear(Y).map(m => {
      const mraw = blend([[zScore(chart, m.pillar), 0.5], [zScore(chart, p), 0.3], [daeunRawAt(a), 0.2]]);
      const s = msToKstDate(m.start), e = msToKstDate(m.end - DAY_MS);
      return { ganji: m.pillar.char, startMs: m.start, endMs: m.end,
               label: `${s.m}/${s.d}~${e.m}/${e.d}`, score: toScore(mraw) };
    });
    return { year: Y, age: a, daeun: daeunDesc(daeunAtAge(daeun, a)),
             ...info, decisions: decisionsOf(chart, p, info._sig, info.score), months };
  }
  const pickMonths = (months, fromMs) => {
    const pool = months.filter(m => m.endMs > (fromMs || 0));
    const sorted = [...pool].sort((x, y) => y.score - x.score);
    const fmt = m => `${m.label}(${m.ganji}월)`;
    return {
      good: sorted.slice(0, Math.min(3, Math.ceil(pool.length / 3))).filter(m => m.score >= 50).map(fmt),
      caution: sorted.slice(-Math.min(2, Math.floor(pool.length / 3) || 1)).filter(m => m.score < 50).map(fmt),
    };
  };
  const clean = o => { delete o._sig; delete o.months; return o; };

  const curYM = sajuYearMonth(nowMs);
  const cur = yearInfo(curYM.sajuYear);
  const curMonths = pickMonths(cur.months, nowMs);
  const present = { ...clean({ ...cur }), goodMonths: curMonths.good, cautionMonths: curMonths.caution };

  const near = [1, 2, 3].map(i => {
    const y = yearInfo(curYM.sajuYear + i);
    const pm = pickMonths(y.months);
    return { ...clean({ ...y }), goodMonths: pm.good, cautionMonths: pm.caution };
  });

  // 과거: 대운 시작 전(월주 영향) + 지나간/진행 중 대운
  const past = [];
  const pre = describe(chart, chart.pillars.month, zScore(chart, chart.pillars.month));
  past.push({ range: `${daeun.startAge > 1 ? '0~' + (daeun.startAge - 1) : '0'}세 (대운 전, 월주 ${chart.pillars.month.char})`,
              startAge: 0, endAge: daeun.startAge - 1, ...clean(pre) });
  daeun.list.filter(d => d.startAge <= age).forEach(d => {
    past.push({ range: `${d.startAge}~${d.endAge}세 (${d.pillar.char} 대운)`,
                startAge: d.startAge, endAge: d.endAge, current: age <= d.endAge,
                ...clean(describe(chart, d.pillar, d.raw)) });
  });

  // 먼 미래: 지금 대운 이후에 시작되는 대운, 90세까지 (진행 중인 대운은 과거·현재에서 다룸)
  const far = daeun.list.filter(d => d.startAge > age && d.startAge <= 90).map(d => ({
    range: `${d.startAge}~${d.endAge}세 (${d.pillar.char} 대운)`,
    startAge: d.startAge, endAge: d.endAge, ...clean(describe(chart, d.pillar, d.raw)),
  }));

  const P = chart.pillars;
  return {
    version: 2,
    chart: {
      gender: chart.input.gender,
      birth: `${by}-${String(bm).padStart(2,'0')}-${String(bd).padStart(2,'0')}`,
      sijin: chart.input.sijinIdx >= 0 ? SIJIN[chart.input.sijinIdx].label : '모름',
      pillars: { year: P.year.char, month: P.month.char, day: P.day.char, hour: P.hour ? P.hour.char : null },
      pillarsKr: { year: P.year.kr, month: P.month.kr, day: P.day.kr, hour: P.hour ? P.hour.kr : null },
      dayMaster: chart.dayMasterText,
      ohaeng: chart.ohaeng,
      strength: chart.strength,
      favorable: chart.favorable, unfavorable: chart.unfavorable,
      notes: chart.notes,
    },
    age,
    daeun: { forward: daeun.forward, startAge: daeun.startAge,
             list: daeun.list.map(d => ({ ...daeunDesc(d), score: toScore(d.raw), label: labelOf(toScore(d.raw)),
                                          startAge: d.startAge, endAge: d.endAge })) },
    past, present, near, far,
  };
}

const api = {
  STEMS, BRANCHES, STEMS_KR, BRANCHES_KR, ELEMENTS, SIJIN,
  sunLongitude, findTerm, kstMs, msToKstDate, monthSegment,
  pillar, yearPillarOf, monthPillarOf, dayPillarOf, hourPillarOf, sajuYearMonth,
  sipsin, calcChart, calcDaeun, analyze,
  isChung, isYukhap, isHyeong,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else { root.Saju = api; root.SIJIN = SIJIN; }
})(typeof window !== 'undefined' ? window : this);

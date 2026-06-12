// 사주팔자 계산 모듈
// 기준: 만세력 기반 간략화 알고리즘 (절기 미반영 근사치)

const STEMS     = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
const BRANCHES  = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
const STEMS_KR  = ['갑','을','병','정','무','기','경','신','임','계'];
const BRANCHES_KR = ['자','축','인','묘','진','사','오','미','신','유','술','해'];

const OHAENG_STEM   = ['목','목','화','화','토','토','금','금','수','수']; // 천간별 오행
const OHAENG_BRANCH = ['수','토','목','목','토','화','화','토','금','금','토','수']; // 지지별 오행

const SIJIN = [
  { label:'자시(子時)',  desc:'밤 11시 ~ 새벽 1시',  branch: 0 },
  { label:'축시(丑時)',  desc:'새벽 1시 ~ 3시',       branch: 1 },
  { label:'인시(寅時)',  desc:'새벽 3시 ~ 5시',       branch: 2 },
  { label:'묘시(卯時)',  desc:'새벽 5시 ~ 7시',       branch: 3 },
  { label:'진시(辰時)',  desc:'아침 7시 ~ 9시',       branch: 4 },
  { label:'사시(巳時)',  desc:'오전 9시 ~ 11시',      branch: 5 },
  { label:'오시(午時)',  desc:'오전 11시 ~ 오후 1시', branch: 6 },
  { label:'미시(未時)',  desc:'오후 1시 ~ 3시',       branch: 7 },
  { label:'신시(申時)',  desc:'오후 3시 ~ 5시',       branch: 8 },
  { label:'유시(酉時)',  desc:'오후 5시 ~ 7시',       branch: 9 },
  { label:'술시(戌時)',  desc:'저녁 7시 ~ 9시',       branch:10 },
  { label:'해시(亥時)',  desc:'밤 9시 ~ 11시',        branch:11 },
];

// ── 년주 ──────────────────────────────────────────────
function getYearPillar(year) {
  const s = ((year - 4) % 10 + 10) % 10;
  const b = ((year - 4) % 12 + 12) % 12;
  return { stem: s, branch: b };
}

// ── 월주 (절기 근사: 양력 월 기준) ────────────────────
function getMonthPillar(year, month) {
  // 월지: 1월=丑(1), 2월=寅(2), ..., 12월=子(0)
  const branchMap = [1,2,3,4,5,6,7,8,9,10,11,0];
  const b = branchMap[month - 1];

  // 월간: 년간(年干)에 따라 寅월(2월)의 시작 천간 결정
  const yStem = ((year - 4) % 10 + 10) % 10;
  const startStem = [2,4,6,8,0][yStem % 5]; // 甲己→丙, 乙庚→戊, 丙辛→庚, 丁壬→壬, 戊癸→甲
  // 寅(branch=2)부터 offset 계산
  const offset = (b - 2 + 12) % 12;
  const s = (startStem + offset) % 10;
  return { stem: s, branch: b };
}

// ── 일주 (기준일: 1900-01-01 = 甲戌日, 60갑자 index=10) ──
const DAY_REF      = new Date(1900, 0, 1);
const DAY_REF_IDX  = 10; // 甲戌

function getDayPillar(year, month, day) {
  const target   = new Date(year, month - 1, day);
  const diffDays = Math.round((target - DAY_REF) / 86400000);
  const idx      = ((DAY_REF_IDX + diffDays) % 60 + 60) % 60;
  return { stem: idx % 10, branch: idx % 12 };
}

// ── 시주 ──────────────────────────────────────────────
function getHourPillar(hourBranchIdx, dayStem) {
  // 子시 천간 시작: 甲己→甲(0), 乙庚→丙(2), 丙辛→戊(4), 丁壬→庚(6), 戊癸→壬(8)
  const startStem = (dayStem % 5) * 2;
  const s = (startStem + hourBranchIdx) % 10;
  return { stem: s, branch: hourBranchIdx };
}

// ── 오행 분포 계산 ─────────────────────────────────────
function calcOhaeng(pillars) {
  const count = { 목:0, 화:0, 토:0, 금:0, 수:0 };
  pillars.forEach(p => {
    if (p) {
      count[OHAENG_STEM[p.stem]]++;
      count[OHAENG_BRANCH[p.branch]]++;
    }
  });
  return count;
}

// ── 기둥 → 표시용 텍스트 ──────────────────────────────
function pillarText(p) {
  return STEMS[p.stem] + BRANCHES[p.branch];
}
function pillarKr(p) {
  return STEMS_KR[p.stem] + BRANCHES_KR[p.branch];
}

// ── 메인 계산 함수 ─────────────────────────────────────
function calculateSaju(year, month, day, sijinIdx) {
  const year_p  = getYearPillar(year);
  const month_p = getMonthPillar(year, month);
  const day_p   = getDayPillar(year, month, day);
  const hour_p  = sijinIdx >= 0 ? getHourPillar(SIJIN[sijinIdx].branch, day_p.stem) : null;

  const pillars = [year_p, month_p, day_p, hour_p];
  const ohaeng  = calcOhaeng(pillars.filter(Boolean));
  const total   = Object.values(ohaeng).reduce((a,b) => a+b, 0);
  const ohaengPct = {};
  for (const k in ohaeng) ohaengPct[k] = Math.round(ohaeng[k] / total * 100);

  return {
    year:  { ...year_p,  char: pillarText(year_p),  kr: pillarKr(year_p)  },
    month: { ...month_p, char: pillarText(month_p), kr: pillarKr(month_p) },
    day:   { ...day_p,   char: pillarText(day_p),   kr: pillarKr(day_p)   },
    hour:  hour_p ? { ...hour_p, char: pillarText(hour_p), kr: pillarKr(hour_p) } : null,
    dayGan:    STEMS[day_p.stem],
    dayGanKr:  STEMS_KR[day_p.stem],
    dayOhaeng: OHAENG_STEM[day_p.stem],
    ohaeng:    ohaengPct,
  };
}

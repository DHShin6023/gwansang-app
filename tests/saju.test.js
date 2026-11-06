// 실행: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const S = require('../saju.js');

const SJ = label => S.SIJIN.findIndex(s => s.label.startsWith(label));
const chart = (y, m, d, sj, g = 'male') => S.calcChart({ year: y, month: m, day: d, sijinIdx: sj, gender: g }).pillars;

test('일주 기준일', () => {
  assert.strictEqual(S.dayPillarOf(1900, 1, 1).char, '甲戌');
  assert.strictEqual(S.dayPillarOf(2000, 1, 1).char, '戊午');
  assert.strictEqual(S.dayPillarOf(2024, 1, 1).char, '甲子');
});

test('입춘 전후로 년주·월주가 바뀐다 (2024 입춘 2/4 17시경)', () => {
  const before = chart(2024, 2, 4, SJ('진시'));
  assert.strictEqual(before.year.char, '癸卯');
  assert.strictEqual(before.month.char, '乙丑');
  const after = chart(2024, 2, 4, SJ('술시'));
  assert.strictEqual(after.year.char, '甲辰');
  assert.strictEqual(after.month.char, '丙寅');
});

test('1월생은 전년도 년주 + 丑월 (V1 버그 회귀)', () => {
  const p = chart(2024, 1, 15, SJ('오시'));
  assert.strictEqual(p.year.char, '癸卯');
  assert.strictEqual(p.month.char, '乙丑');
  // 1월 초(소한 전)는 전년도 子월
  assert.strictEqual(chart(2024, 1, 3, SJ('오시')).month.char, '甲子');
});

test('절(節) 기준 월주: 2026 입동(11/7) 전후', () => {
  assert.strictEqual(chart(2026, 11, 6, SJ('오시')).month.char, '戊戌');
  assert.strictEqual(chart(2026, 11, 8, SJ('오시')).month.char, '己亥');
  assert.strictEqual(chart(2026, 11, 6, SJ('오시')).year.char, '丙午');
});

test('자시 2분할: 밤 자시는 다음 날 일주', () => {
  const dawn = chart(2024, 1, 1, SJ('자시(子時) · 새벽'));
  assert.strictEqual(dawn.day.char, '甲子');
  assert.strictEqual(dawn.hour.char, '甲子');
  const night = chart(2024, 1, 1, SJ('자시(子時) · 밤'));
  assert.strictEqual(night.day.char, '乙丑');
  assert.strictEqual(night.hour.char, '丙子');
});

test('시주 천간 (甲己일 → 甲子시 시작)', () => {
  assert.strictEqual(S.hourPillarOf(0, 6).char, '庚午');
  assert.strictEqual(S.hourPillarOf(4, 0).char, '壬子');
});

test('시 모름이면 시주 없음', () => {
  assert.strictEqual(chart(1990, 5, 5, -1).hour, null);
});

test('대운 순역: 양년 남자 순행, 양년 여자 역행', () => {
  const m = S.calcDaeun(S.calcChart({ year: 1990, month: 5, day: 20, sijinIdx: 6, gender: 'male' }));
  const f = S.calcDaeun(S.calcChart({ year: 1990, month: 5, day: 20, sijinIdx: 6, gender: 'female' }));
  assert.strictEqual(m.forward, true);   // 庚午년 = 양
  assert.strictEqual(f.forward, false);
  const month = chart(1990, 5, 20, 6).month; // 입하(5/6) 이후 → 辛巳
  assert.strictEqual(month.char, '辛巳');
  assert.strictEqual(m.list[0].pillar.char, '壬午');
  assert.strictEqual(f.list[0].pillar.char, '庚辰');
  for (const d of [m, f]) assert.ok(d.startAge >= 1 && d.startAge <= 10);
  // 5/20 정오 → 순행: 망종(6/6경)까지 약 17일 → 6세, 역행: 입하(5/6)까지 약 14일 → 5세
  assert.strictEqual(m.startAge, 6);
  assert.strictEqual(f.startAge, 5);
});

test('십신', () => {
  assert.strictEqual(S.sipsin(0, 0), '비견');
  assert.strictEqual(S.sipsin(0, 1), '겁재');
  assert.strictEqual(S.sipsin(0, 2), '식신');
  assert.strictEqual(S.sipsin(0, 3), '상관');
  assert.strictEqual(S.sipsin(0, 4), '편재');
  assert.strictEqual(S.sipsin(0, 5), '정재');
  assert.strictEqual(S.sipsin(0, 6), '편관');
  assert.strictEqual(S.sipsin(0, 7), '정관');
  assert.strictEqual(S.sipsin(0, 8), '편인');
  assert.strictEqual(S.sipsin(0, 9), '정인');
});

test('analyze 결과 구조와 결정성', () => {
  const now = new Date(Date.UTC(2026, 10, 6, 3));
  const inp = { year: 1985, month: 3, day: 20, sijinIdx: 4, gender: 'female' };
  const a = S.analyze(inp, now), b = S.analyze(inp, now);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.present.year, 2026);
  assert.deepStrictEqual(a.near.map(n => n.year), [2027, 2028, 2029]);
  assert.strictEqual(a.age, 41);
  assert.ok(a.past.length >= 2 && a.far.length >= 2);
  assert.ok(a.past.some(p => p.current));
  for (const k of ['job', 'move', 'marriage', 'money']) assert.ok(a.present.decisions[k]);
});

test('진행 중인 대운은 먼 미래(far)에 중복되지 않는다', () => {
  const now = new Date(Date.UTC(2026, 10, 6, 3));
  for (const inp of [{ year: 2020, month: 3, day: 1, sijinIdx: 6, gender: 'male' },
                     { year: 1985, month: 3, day: 20, sijinIdx: 4, gender: 'female' }]) {
    const a = S.analyze(inp, now);
    const pastRanges = new Set(a.past.map(p => p.range));
    assert.ok(a.far.every(f => !pastRanges.has(f.range)));
    assert.ok(a.far.every(f => f.startAge > a.age));
  }
});

// 차별성 시뮬레이션: node tests/diversity.sim.js
const S = require('../saju.js');
let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const now = new Date(Date.UTC(2026, 10, 6, 3));
const N = 300, people = [];
for (let i = 0; i < N; i++) {
  const year = 1950 + Math.floor(rnd() * 56), month = 1 + Math.floor(rnd() * 12), day = 1 + Math.floor(rnd() * 28);
  const sijinIdx = rnd() < 0.15 ? -1 : Math.floor(rnd() * 13);
  people.push(S.analyze({ year, month, day, sijinIdx, gender: rnd() < 0.5 ? 'male' : 'female' }, now));
}
const count = arr => arr.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {});
const pct = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v / N * 100) + '%']));
const scores = people.map(p => p.present.score).sort((a, b) => a - b);
const q = f => scores[Math.floor(f * (N - 1))];
console.log('올해 점수 분위수 p10/p25/p50/p75/p90:', q(.1), q(.25), q(.5), q(.75), q(.9));
console.log('올해 라벨:', pct(count(people.map(p => p.present.label))));
console.log('신강/신약:', pct(count(people.map(p => p.chart.strength.label))));
const pattern = people.map(p => [p.present, ...p.near].map(y => y.label[0]).join(''));
const pc = count(pattern);
console.log('4년 흐름 패턴 종류:', Object.keys(pc).length, '/ 최다 패턴 비중:', Math.max(...Object.values(pc)) / N * 100 | 0, '%');
for (const k of ['job', 'move', 'marriage', 'money'])
  console.log(`올해 결정 ${k}:`, pct(count(people.map(p => p.present.decisions[k]))));
const allYearLabels = people.flatMap(p => [p.present, ...p.near].map(y => y.label));
console.log('4년 전체 라벨:', Object.fromEntries(Object.entries(count(allYearLabels)).map(([k, v]) => [k, Math.round(v / allYearLabels.length * 100) + '%'])));
const daeunLabels = people.flatMap(p => p.daeun.list.map(d => d.label));
console.log('대운 라벨:', Object.fromEntries(Object.entries(count(daeunLabels)).map(([k, v]) => [k, Math.round(v / daeunLabels.length * 100) + '%'])));
// 한 사람 안에서도 시기별 기복이 있는가
const flat = people.filter(p => new Set(p.daeun.list.map(d => d.label)).size === 1).length;
console.log('10개 대운이 전부 같은 라벨인 사람:', flat, '명');
const noCaution = people.filter(p => ![p.present, ...p.near].some(y => y.label === '조정' || y.flags.length)).length;
console.log('4년 내 조정·변동 신호가 하나도 없는 사람:', noCaution, '명');

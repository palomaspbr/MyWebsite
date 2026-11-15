// Unit tests for jiujitsu/js/stats.js.  Run: node --test tests/jiujitsu/stats.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const S = require(path.join(__dirname, '..', '..', 'jiujitsu', 'js', 'stats.js'));

const P = (id, name, belt = 'white') => ({ id, name, belt, stripes: 0 });
let rid = 0;
const R = (a, b, winner, date = '2024-01-01', method = '', extra = {}) =>
  ({ id: ++rid, a, b, winner, date, method, ...extra });
const row = (rows, id) => rows.find((r) => r.player.id === id);

test('exports', () => {
  assert.deepEqual(S.BELTS, ['white', 'blue', 'purple', 'brown', 'black']);
  assert.deepEqual(S.BELT_VALUE, { white: 1, blue: 2, purple: 3, brown: 4, black: 5 });
  for (const k of ['table', 'headToHead', 'chrono', 'rollPoints', 'rollDelta']) assert.equal(typeof S[k], 'function');
});

test('empty inputs', () => {
  assert.deepEqual(S.table([], []), []);
  const rows = S.table([P(1, 'A')], []);
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { points: rows[0].points, wins: rows[0].wins, draws: rows[0].draws, losses: rows[0].losses, rolls: rows[0].rolls, streak: rows[0].streak, rank: rows[0].rank, favorite: rows[0].favorite },
    { points: 0, wins: 0, draws: 0, losses: 0, rolls: 0, streak: 0, rank: null, favorite: '' }); // no rolls = no rank
});

test('points: win 3, draw 1, loss 0', () => {
  const ps = [P(1, 'A'), P(2, 'B'), P(3, 'C')];
  const rows = S.table(ps, [R(1, 2, 1), R(1, 3, null), R(3, 2, 2), R(2, 1, 1)]);
  const a = row(rows, 1), b = row(rows, 2), c = row(rows, 3);
  assert.deepEqual([a.wins, a.draws, a.losses, a.points, a.rolls], [2, 1, 0, 7, 3]);
  assert.deepEqual([b.wins, b.draws, b.losses, b.points, b.rolls], [1, 0, 2, 3, 3]);
  assert.deepEqual([c.wins, c.draws, c.losses, c.points, c.rolls], [0, 1, 1, 1, 2]);
  assert.deepEqual(rows.map((r) => r.player.id), [1, 2, 3]);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3]);
});

test('does not mutate inputs', () => {
  const ps = [P(1, 'A'), P(2, 'B')];
  const rolls = [R(1, 2, 1, '2024-02-01'), R(1, 2, 2, '2024-01-01')];
  const snap = JSON.stringify([ps, rolls]);
  S.table(ps, rolls);
  S.chrono(rolls);
  assert.equal(JSON.stringify([ps, rolls]), snap);
});

test('tie-break: points, then more wins', () => {
  // X: 1 win 0 draws (3 pts). Y: 3 draws (3 pts). X ahead on wins.
  const ps = [P(1, 'Y'), P(2, 'X'), P(3, 'Z'), P(4, 'W'), P(5, 'V')];
  const rolls = [R(2, 3, 2), R(1, 4, null), R(1, 5, null), R(1, 3, null)];
  const rows = S.table(ps, rolls);
  assert.equal(row(rows, 1).points, 3);
  assert.equal(row(rows, 2).points, 3);
  assert.ok(rows.indexOf(row(rows, 2)) < rows.indexOf(row(rows, 1)));
  assert.equal(row(rows, 2).rank, 1);
  assert.equal(row(rows, 1).rank, 2);
});

test('tie-break: fewer losses', () => {
  // A: W L L W? keep simple: A 1W 0L; B 1W 1L. same points (3), same wins, B has more losses.
  const ps = [P(1, 'B'), P(2, 'A'), P(3, 'C'), P(4, 'D')];
  const rolls = [R(1, 3, 1), R(1, 2, 2), R(2, 4, null), R(1, 4, null)];
  // A(2): win vs B, draw vs D -> 4 pts, 1W 0L. B(1): win vs C, loss vs A, draw vs D -> 4 pts 1W 1L.
  const rows = S.table(ps, rolls);
  assert.equal(row(rows, 1).points, row(rows, 2).points);
  assert.equal(row(rows, 1).wins, row(rows, 2).wins);
  assert.ok(rows.indexOf(row(rows, 2)) < rows.indexOf(row(rows, 1)));
  assert.notEqual(row(rows, 1).rank, row(rows, 2).rank);
});

test('players without rolls go last and get no rank; among them: higher belt, then name (case-insensitive)', () => {
  const ps = [P(1, 'bob', 'white'), P(2, 'Al', 'white'), P(3, 'Cy', 'black'), P(4, 'dee', 'blue'), P(5, 'Top', 'white')];
  const rolls = [R(5, 1, 5)]; // Top 3 pts; bob 0 pts with a loss
  const rows = S.table(ps, rolls);
  assert.deepEqual(rows.map((r) => r.player.name), ['Top', 'bob', 'Cy', 'dee', 'Al']);
  // bob rolled (and lost) so he is ranked 2nd; Cy, dee and Al haven't rolled: listed after, unranked
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, null, null, null]);
});

test('shared rank with points tie (1,1,3)', () => {
  const ps = [P(1, 'A'), P(2, 'B'), P(3, 'C'), P(4, 'D')];
  const rolls = [R(1, 3, 1), R(2, 4, 2)];
  const rows = S.table(ps, rolls);
  assert.deepEqual(rows.map((r) => r.rank), [1, 1, 3, 3]);
});

test('streak: counts consecutive wins, resets on loss and on draw', () => {
  const ps = [P(1, 'A'), P(2, 'B')];
  let rows = S.table(ps, [R(1, 2, 1, '2024-01-01'), R(1, 2, 1, '2024-01-02'), R(2, 1, 1, '2024-01-03')]);
  assert.equal(row(rows, 1).streak, 3);
  assert.equal(row(rows, 2).streak, 0);
  rows = S.table(ps, [R(1, 2, 1, '2024-01-01'), R(1, 2, 1, '2024-01-02'), R(1, 2, 2, '2024-01-03')]);
  assert.equal(row(rows, 1).streak, 0);
  assert.equal(row(rows, 2).streak, 1);
  rows = S.table(ps, [R(1, 2, 1, '2024-01-01'), R(1, 2, 1, '2024-01-02'), R(1, 2, null, '2024-01-03')]);
  assert.equal(row(rows, 1).streak, 0);
  rows = S.table(ps, [R(1, 2, null, '2024-01-01'), R(1, 2, 1, '2024-01-02'), R(1, 2, 1, '2024-01-03')]);
  assert.equal(row(rows, 1).streak, 2);
});

test('streak uses chronological order, not array order; same-date ties by id', () => {
  const ps = [P(1, 'A'), P(2, 'B')];
  // newest-first array (as the API returns): loss is oldest
  const rolls = [
    { id: 30, a: 1, b: 2, winner: 1, date: '2024-03-01' },
    { id: 20, a: 1, b: 2, winner: 1, date: '2024-02-01' },
    { id: 10, a: 1, b: 2, winner: 2, date: '2024-01-01' },
  ];
  assert.equal(row(S.table(ps, rolls), 1).streak, 2);
  // same date: higher id is later
  const same = [
    { id: 6, a: 1, b: 2, winner: 2, date: '2024-01-01' },
    { id: 5, a: 1, b: 2, winner: 1, date: '2024-01-01' },
  ];
  assert.equal(row(S.table(ps, same), 1).streak, 0);
  assert.equal(row(S.table(ps, same), 2).streak, 1);
  assert.deepEqual(S.chrono(same).map((r) => r.id), [5, 6]);
  assert.deepEqual(S.chrono(rolls).map((r) => r.id), [10, 20, 30]);
});

test('favorite finish: most frequent winning method, trimmed, case-insensitive, ignores losses and blanks', () => {
  const ps = [P(1, 'A'), P(2, 'B')];
  const rolls = [
    R(1, 2, 1, '2024-01-01', 'Armbar'),
    R(1, 2, 1, '2024-01-02', ' Choke '),
    R(1, 2, 1, '2024-01-03', 'choke'),
    R(1, 2, 1, '2024-01-04', ''),
    R(1, 2, 1, '2024-01-05', '   '),
    R(1, 2, 2, '2024-01-06', 'Kimura'), // B's win
    R(1, 2, null, '2024-01-07', 'Triangle'), // draw: no favorite credit
  ];
  const rows = S.table(ps, rolls);
  assert.equal(row(rows, 1).favorite, 'choke');
  assert.deepEqual(row(rows, 1).subs, { armbar: 1, choke: 2 });
  assert.equal(row(rows, 2).favorite, 'kimura');
  assert.equal(S.table(ps, [R(1, 2, null, '2024-01-01', 'Armbar')])[0].favorite, '');
});

test('favorite tie goes to the method reached first', () => {
  const ps = [P(1, 'A'), P(2, 'B')];
  const rows = S.table(ps, [R(1, 2, 1, '2024-01-01', 'Kimura'), R(1, 2, 1, '2024-01-02', 'Armbar')]);
  assert.equal(row(rows, 1).favorite, 'kimura');
});

test('rolls referencing missing players are ignored', () => {
  const ps = [P(1, 'A'), P(2, 'B')];
  const rows = S.table(ps, [R(1, 99, 1), R(99, 2, 99), R(98, 99, null), R(1, 2, 2)]);
  assert.equal(rows.length, 2);
  assert.deepEqual([row(rows, 1).rolls, row(rows, 1).points, row(rows, 1).wins], [1, 0, 0]);
  assert.deepEqual([row(rows, 2).rolls, row(rows, 2).points, row(rows, 2).wins], [1, 3, 1]);
});

test('roll whose winner is neither player does not count', () => {
  const ps = [P(1, 'A'), P(2, 'B')];
  const rows = S.table(ps, [R(1, 2, 1, '2024-01-01'), R(1, 2, 77, '2024-01-02')]);
  const a = row(rows, 1);
  assert.equal(a.points, 3);
  assert.equal(a.wins + a.draws + a.losses, 1);
  // Consistency: rolls should equal W+D+L (bad rolls are ignored like missing-player rolls).
  assert.equal(a.rolls, a.wins + a.draws + a.losses, 'rolls counted for a roll with an invalid winner');
});

test('headToHead', () => {
  const rolls = [R(1, 2, 1), R(2, 1, 1), R(2, 1, 2), R(1, 2, null), R(1, 3, 1), R(3, 2, 3)];
  assert.deepEqual(S.headToHead(rolls, 1, 2), { wins: 2, draws: 1, losses: 1 });
  assert.deepEqual(S.headToHead(rolls, 2, 1), { wins: 1, draws: 1, losses: 2 });
  assert.deepEqual(S.headToHead(rolls, 1, 3), { wins: 1, draws: 0, losses: 0 });
  assert.deepEqual(S.headToHead(rolls, 1, 4), { wins: 0, draws: 0, losses: 0 });
  assert.deepEqual(S.headToHead([], 1, 2), { wins: 0, draws: 0, losses: 0 });
  // undefined winner counts as draw (== null)
  assert.deepEqual(S.headToHead([{ id: 1, a: 1, b: 2 }], 1, 2), { wins: 0, draws: 1, losses: 0 });
});

test('headToHead agrees with table for a two-player league', () => {
  const ps = [P(1, 'A'), P(2, 'B')];
  const rolls = [R(1, 2, 1), R(2, 1, 1), R(2, 1, 2), R(1, 2, null)];
  const a = row(S.table(ps, rolls), 1);
  assert.deepEqual(S.headToHead(rolls, 1, 2), { wins: a.wins, draws: a.draws, losses: a.losses });
});

test('headToHead ignores a winner that is neither player (consistent with table)', () => {
  assert.deepEqual(S.headToHead([R(1, 2, 77)], 1, 2), { wins: 0, draws: 0, losses: 0 });
});

test('belt tie-break among players who rolled; shared rank needs the same points, wins and losses', () => {
  const ps = [P(1, 'a', 'white'), P(2, 'b', 'black'), P(3, 'c', 'white'), P(4, 'd', 'black')];
  // Same-belt draws: everyone ends 1 pt, 0W 1D 0L. Order: higher belt first, then name.
  const rows = S.table(ps, [R(1, 3, null), R(2, 4, null)]);
  assert.deepEqual(rows.map((r) => r.player.name), ['b', 'd', 'a', 'c']);
  assert.deepEqual(rows.map((r) => r.points), [1, 1, 1, 1]);
  assert.deepEqual(rows.map((r) => r.rank), [1, 1, 1, 1]);
});

// ---------- belt-weighted points ----------
test('rollPoints: the examples from the rules table', () => {
  const W = (m, o) => S.rollPoints(m, o, 'win'), L = (m, o) => S.rollPoints(m, o, 'loss'), D = (m, o) => S.rollPoints(m, o, 'draw');
  assert.equal(W('white', 'white'), 3);
  assert.equal(W('white', 'blue'), 5);
  assert.equal(W('white', 'black'), 11);
  assert.equal(W('black', 'white'), 3);
  assert.equal(W('black', 'black'), 7);
  assert.equal(L('black', 'white'), -4);
  assert.equal(L('black', 'blue'), -3);
  assert.equal(L('purple', 'white'), -2);
  assert.equal(L('white', 'black'), 0);
  assert.equal(L('blue', 'blue'), 0);
  assert.equal(D('white', 'white'), 1);
  assert.equal(D('white', 'black'), 5);
  assert.equal(D('black', 'white'), -3);
});

test('rollPoints: the rules hold for every belt pair', () => {
  const B = S.BELTS;
  for (const me of B) {
    // A win is always worth something, and beating a higher belt is always worth more.
    for (let i = 0; i < B.length; i++) {
      assert.ok(S.rollPoints(me, B[i], 'win') >= 3, `${me} beats ${B[i]}`);
      if (i > 0) assert.ok(S.rollPoints(me, B[i], 'win') > S.rollPoints(me, B[i - 1], 'win'), `${me}: beating ${B[i]} > beating ${B[i - 1]}`);
      if (i > 0) assert.ok(S.rollPoints(me, B[i], 'loss') >= S.rollPoints(me, B[i - 1], 'loss'), `${me}: losing to a lower belt costs more`);
    }
    // Draws share 2 points between the two players.
    for (const opp of B) assert.equal(S.rollPoints(me, opp, 'draw') + S.rollPoints(opp, me, 'draw'), 2);
    // Never losing points against an equal or higher belt.
    for (let i = B.indexOf(me); i < B.length; i++) assert.equal(S.rollPoints(me, B[i], 'loss'), 0);
  }
  // An upset is worth more to the lower belt than the same result for the higher belt.
  assert.ok(S.rollPoints('white', 'black', 'win') > S.rollPoints('black', 'white', 'win'));
  assert.ok(S.rollPoints('black', 'white', 'loss') < S.rollPoints('white', 'black', 'loss'));
});

test('table: points use the belts recorded with the roll, not current belts', () => {
  // Ana is a black belt now, but beat Bia (black) back when she was white: +11 stays +11.
  const ps = [P(1, 'Ana', 'black'), P(2, 'Bia', 'black')];
  const rolls = [R(1, 2, 1, '2024-01-01', '', { belt_a: 'white', belt_b: 'black' })];
  const rows = S.table(ps, rolls);
  assert.equal(row(rows, 1).points, 11);
  assert.equal(row(rows, 2).points, -4);
  // Without recorded belts (old rolls), current belts are used: black vs black.
  const old = S.table(ps, [R(1, 2, 1)]);
  assert.equal(row(old, 1).points, 7);
  assert.equal(row(old, 2).points, 0);
});

test('table: a higher belt losing and drawing to lower belts can go negative and rank below them', () => {
  const ps = [P(1, 'Black', 'black'), P(2, 'White', 'white'), P(3, 'Blue', 'blue')];
  const rows = S.table(ps, [R(2, 1, 2), R(3, 1, null)]); // white beats black, blue draws black
  assert.equal(row(rows, 2).points, 11);  // white upset
  assert.equal(row(rows, 3).points, 4);   // blue draws black: 1 + 3
  assert.equal(row(rows, 1).points, -6);  // -4 (loss) + -2 (draw)
  assert.deepEqual(rows.map((r) => r.player.name), ['White', 'Blue', 'Black']);
});

test('rollDelta: both sides of one roll', () => {
  const beltOf = (id) => ({ 1: 'white', 2: 'brown' })[id];
  assert.deepEqual(S.rollDelta({ a: 1, b: 2, winner: 1 }, beltOf), { a: 9, b: -3 });
  assert.deepEqual(S.rollDelta({ a: 1, b: 2, winner: 2 }, beltOf), { a: 0, b: 3 });
  assert.deepEqual(S.rollDelta({ a: 1, b: 2, winner: null }, beltOf), { a: 4, b: -2 });
});

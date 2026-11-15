/* Pure leaderboard math. Works in the browser (window.JJStats) and in Node (require). */
(function (root) {
  'use strict';

  const BELTS = ['white', 'blue', 'purple', 'brown', 'black'];
  const BELT_VALUE = { white: 1, blue: 2, purple: 3, brown: 4, black: 5 };

  /* Belt-weighted points. gap = opponent's belt value - yours.
       win:  2 + opponent's value, + gap if they're a higher belt  (white beats white +3, blue +5, black +11)
       loss: 0 against an equal/higher belt, -(your value - theirs) against a lower one  (black loses to white -4)
       draw: 1 + gap  (equal belts +1 each; white draws black: white +5, black -3) */
  function rollPoints(myBelt, oppBelt, result) {
    const mine = BELT_VALUE[myBelt] || 1, opp = BELT_VALUE[oppBelt] || 1;
    const gap = opp - mine;
    if (result === 'win') return 2 + opp + Math.max(0, gap);
    if (result === 'loss') return Math.min(0, gap);
    return 1 + gap;
  }

  // Points each side got from one roll, using the belts recorded with the roll
  // (falls back to current belts for rolls logged before belts were recorded).
  function rollDelta(r, beltOf) {
    const ba = r.belt_a || beltOf(r.a) || 'white';
    const bb = r.belt_b || beltOf(r.b) || 'white';
    if (r.winner == null) return { a: rollPoints(ba, bb, 'draw'), b: rollPoints(bb, ba, 'draw') };
    const aWon = r.winner === r.a;
    return { a: rollPoints(ba, bb, aWon ? 'win' : 'loss'), b: rollPoints(bb, ba, aWon ? 'loss' : 'win') };
  }

  function blank(p) {
    return { player: p, points: 0, wins: 0, draws: 0, losses: 0, rolls: 0, streak: 0, subs: {}, rank: 0 };
  }

  // Rolls in chronological order (oldest first), ties broken by id.
  function chrono(rolls) {
    return rolls.slice().sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.id - y.id));
  }

  function table(players, rolls) {
    const byId = new Map();
    players.forEach((p) => byId.set(p.id, blank(p)));
    const beltOf = (id) => { const x = byId.get(id); return x && x.player.belt; };
    chrono(rolls).forEach((r) => {
      const A = byId.get(r.a), B = byId.get(r.b);
      if (!A || !B) return;
      if (r.winner != null && r.winner !== r.a && r.winner !== r.b) return; // bad data: ignore
      A.rolls++; B.rolls++;
      const d = rollDelta(r, beltOf);
      A.points += d.a; B.points += d.b;
      if (r.winner == null) {
        A.draws++; B.draws++;
        A.streak = 0; B.streak = 0;
        return;
      }
      const W = r.winner === r.a ? A : B;
      const L = W === A ? B : A;
      W.wins++; L.losses++;
      W.streak = W.streak > 0 ? W.streak + 1 : 1;
      L.streak = 0;
      const m = (r.method || '').trim().toLowerCase();
      if (m) W.subs[m] = (W.subs[m] || 0) + 1;
    });
    const rows = Array.from(byId.values());
    rows.sort((x, y) =>
      (y.rolls > 0) - (x.rolls > 0) || // people who haven't rolled yet go last
      y.points - x.points ||
      y.wins - x.wins ||
      x.losses - y.losses ||
      BELTS.indexOf(y.player.belt) - BELTS.indexOf(x.player.belt) ||
      x.player.name.localeCompare(y.player.name, undefined, { sensitivity: 'base' }));
    // Competition ranking: equal points, wins and losses share a rank. No rolls yet = no rank (null).
    rows.forEach((row, i) => {
      const prev = rows[i - 1];
      if (!row.rolls) row.rank = null;
      else row.rank = prev && prev.rolls && prev.points === row.points && prev.wins === row.wins && prev.losses === row.losses ? prev.rank : i + 1;
      let fav = '', favN = 0;
      Object.keys(row.subs).forEach((k) => { if (row.subs[k] > favN) { fav = k; favN = row.subs[k]; } });
      row.favorite = fav;
    });
    return rows;
  }

  // Head-to-head record of player `me` against `them`.
  function headToHead(rolls, me, them) {
    const out = { wins: 0, draws: 0, losses: 0 };
    rolls.forEach((r) => {
      if (!((r.a === me && r.b === them) || (r.a === them && r.b === me))) return;
      if (r.winner == null) out.draws++;
      else if (r.winner === me) out.wins++;
      else if (r.winner === them) out.losses++;
    });
    return out;
  }

  const api = { BELTS, BELT_VALUE, rollPoints, rollDelta, table, headToHead, chrono };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JJStats = api;
})(typeof window !== 'undefined' ? window : this);

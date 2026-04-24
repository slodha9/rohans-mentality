import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ref, onValue, set, update, remove, get } from 'firebase/database';
import { db } from './firebase';
import { DEFAULT_QUESTIONS } from './questions';
import './styles.css';

const GAME_PATH = 'rohansMentality/liveGame';
const PLAYER_KEY = 'rohans-mentality-player-id';
const ROLE_KEY = 'rohans-mentality-role';

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const clean = (value = '') => value.trim().slice(0, 100);
const normalize = (value = '') => value
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9\s]/g, '')
  .replace(/\b(the|a|an|and|or|to|of|his|her|with)\b/g, '')
  .replace(/\s+/g, ' ')
  .trim();

function groupAnswers(players, answers, excludeRoles = []) {
  const groups = {};
  Object.entries(answers || {}).forEach(([playerId, answer]) => {
    const player = players?.[playerId];
    if (!player || excludeRoles.includes(player.role)) return;
    const display = clean(answer.answer || '(no answer)') || '(no answer)';
    const key = normalize(display) || '__blank__';
    if (!groups[key]) groups[key] = { key, display, count: 0, playerIds: [] };
    groups[key].count += 1;
    groups[key].playerIds.push(playerId);
    if (display.length < groups[key].display.length || groups[key].display === '(no answer)') groups[key].display = display;
  });
  return Object.values(groups).sort((a, b) => b.count - a.count || a.display.localeCompare(b.display));
}

function getRound(game) {
  return game?.rounds?.[game.currentRound] || {};
}

function eligiblePlayerIds(game, includeRohan = true) {
  return Object.entries(game?.players || {})
    .filter(([, p]) => p.role === 'player' || (includeRohan && p.role === 'rohan'))
    .map(([id]) => id);
}

function App() {
  const [game, setGame] = useState(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('player');
  const [timerMinutes, setTimerMinutes] = useState(2);
  const [me, setMe] = useState(() => localStorage.getItem(PLAYER_KEY));
  const [answer, setAnswer] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const unsub = onValue(ref(db, GAME_PATH), snap => setGame(snap.val()));
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { unsub(); clearInterval(tick); };
  }, []);

  const player = me && game?.players ? game.players[me] : null;
  const round = getRound(game);
  const question = game?.questions?.[game.currentRound];
  const submitted = !!round?.answers?.[me];
  const secondsLeft = Math.max(0, Math.ceil(((round?.startedAt || 0) + (game?.timerSeconds || 120) * 1000 - now) / 1000));

  const groups = useMemo(() => groupAnswers(game?.players, round?.answers, ['admin', 'rohan']), [game, round]);
  const rohanEntry = Object.entries(game?.players || {}).find(([, p]) => p.role === 'rohan');
  const rohanId = rohanEntry?.[0];
  const rohanAnswer = rohanId ? clean(round?.answers?.[rohanId]?.answer || '') : '';
  const herdAnswer = groups[0]?.display || '';

  async function createGame() {
    const id = uid();
    const adminName = clean(name) || 'Admin';
    localStorage.setItem(PLAYER_KEY, id);
    localStorage.setItem(ROLE_KEY, 'admin');
    setMe(id);
    await set(ref(db, GAME_PATH), {
      status: 'lobby',
      createdAt: Date.now(),
      timerSeconds: Math.max(15, Number(timerMinutes) * 60),
      currentRound: 0,
      questions: DEFAULT_QUESTIONS,
      players: {
        [id]: { name: adminName, role: 'admin', score: 0, joinedAt: Date.now() }
      },
      rounds: {}
    });
  }

  async function joinGame() {
    const snap = await get(ref(db, GAME_PATH));
    if (!snap.exists()) return alert('No game found. Ask admin to create the game first.');
    const g = snap.val();
    const chosenRole = role;
    if (chosenRole === 'admin') return alert('Admin should create the game, not join it.');
    if (chosenRole === 'rohan' && Object.values(g.players || {}).some(p => p.role === 'rohan')) return alert('Rohan already joined. Pick Player instead.');
    const id = uid();
    localStorage.setItem(PLAYER_KEY, id);
    localStorage.setItem(ROLE_KEY, chosenRole);
    setMe(id);
    await set(ref(db, `${GAME_PATH}/players/${id}`), {
      name: clean(name) || (chosenRole === 'rohan' ? 'Rohan' : 'Player'),
      role: chosenRole,
      score: 0,
      joinedAt: Date.now()
    });
  }

  async function startRound(index = 0) {
    const hasRohan = Object.values(game.players || {}).some(p => p.role === 'rohan');
    const players = Object.values(game.players || {}).filter(p => p.role === 'player').length;
    if (!hasRohan || players < 1) return alert('Need Admin, Rohan, and at least 1 player to start.');
    await update(ref(db, GAME_PATH), {
      status: 'answering',
      currentRound: index,
      [`rounds/${index}`]: { startedAt: Date.now(), status: 'answering', answers: {}, disqualified: null }
    });
  }

  async function submitAnswer(value = answer, auto = false) {
    if (!me || !question || submitted || game.status !== 'answering') return;
    const finalAnswer = clean(value) || (auto ? '(no answer)' : '');
    if (!finalAnswer) return alert('Type an answer first.');
    await set(ref(db, `${GAME_PATH}/rounds/${game.currentRound}/answers/${me}`), {
      answer: finalAnswer,
      at: Date.now(),
      auto
    });
    setAnswer('');
  }

  async function revealRound() {
    const fresh = (await get(ref(db, GAME_PATH))).val();
    if (!fresh || fresh.status !== 'answering') return;
    const freshRound = getRound(fresh);
    const freshGroups = groupAnswers(fresh.players, freshRound.answers, ['admin', 'rohan']);
    const herdKey = freshGroups[0]?.key || '';
    const rohanPlayer = Object.entries(fresh.players || {}).find(([, p]) => p.role === 'rohan');
    const rohanKey = rohanPlayer ? normalize(freshRound.answers?.[rohanPlayer[0]]?.answer || '') : '';
    const scoreUpdates = {};
    const roundScores = {};
    Object.entries(fresh.players || {}).forEach(([id, p]) => {
      if (p.role !== 'player') return;
      const key = normalize(freshRound.answers?.[id]?.answer || '');
      let delta = 0;
      const messages = [];
      if (key && key === herdKey) { delta += 2; messages.push('Rohan says you just alright.'); }
      if (key && rohanKey && key === rohanKey) { delta += 5; messages.push('Rohan says you are exceptional.'); }
      scoreUpdates[`players/${id}/score`] = (p.score || 0) + delta;
      roundScores[id] = { delta, messages };
    });
    await update(ref(db, GAME_PATH), {
      status: 'reveal',
      [`rounds/${fresh.currentRound}/status`]: 'reveal',
      [`rounds/${fresh.currentRound}/herdAnswer`]: freshGroups[0]?.display || '',
      [`rounds/${fresh.currentRound}/rohanAnswer`]: rohanPlayer ? clean(freshRound.answers?.[rohanPlayer[0]]?.answer || '') : '',
      [`rounds/${fresh.currentRound}/scoreDeltas`]: roundScores,
      ...scoreUpdates
    });
  }

  async function disqualify(playerId) {
    if (!player || player.role !== 'rohan' || round.disqualified) return;
    const p = game.players[playerId];
    if (!p || p.role !== 'player') return;
    await update(ref(db, GAME_PATH), {
      [`players/${playerId}/score`]: (p.score || 0) - 1,
      [`rounds/${game.currentRound}/disqualified`]: playerId,
      [`rounds/${game.currentRound}/scoreDeltas/${playerId}/dq`]: -1
    });
  }

  async function nextRound() {
    const next = game.currentRound + 1;
    if (next >= game.questions.length) return endGame();
    await startRound(next);
  }

  async function endGame() {
    await update(ref(db, GAME_PATH), { status: 'ended', endedAt: Date.now() });
  }

  async function resetGame() {
    if (confirm('Delete this game and start fresh?')) {
      localStorage.removeItem(PLAYER_KEY);
      localStorage.removeItem(ROLE_KEY);
      setMe(null);
      await remove(ref(db, GAME_PATH));
    }
  }

  useEffect(() => {
    if (!game || game.status !== 'answering' || !player) return;
    const ids = eligiblePlayerIds(game, true);
    const allSubmitted = ids.length > 0 && ids.every(id => !!round?.answers?.[id]);
    if (allSubmitted) revealRound();
    if (secondsLeft === 0) {
      if ((player.role === 'player' || player.role === 'rohan') && !submitted) submitAnswer('', true);
      revealRound();
    }
  }, [secondsLeft, game?.status, submitted, player?.role, round?.answers]);

  if (!game || !player) {
    return <main className="shell landing">
      <section className="hero card">
        <p className="eyebrow">dark herd energy • birthday edition</p>
        <h1>Rohan's Mentality</h1>
        <p className="tagline">Think like everyone for points. Think like Rohan for glory.</p>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" maxLength={30} />
        <div className="joinGrid">
          <button className="primary" onClick={createGame}>Create Game as Admin</button>
          <div className="joinBox">
            <select value={role} onChange={e => setRole(e.target.value)}>
              <option value="player">Player</option>
              <option value="rohan">Rohan</option>
            </select>
            <button onClick={joinGame}>Join Game</button>
          </div>
        </div>
        <label className="timerLabel">Timer per question
          <select value={timerMinutes} onChange={e => setTimerMinutes(e.target.value)}>
            <option value="1">1 minute</option>
            <option value="2">2 minutes</option>
            <option value="3">3 minutes</option>
            <option value="5">5 minutes</option>
            <option value="10">10 minutes</option>
          </select>
        </label>
      </section>
    </main>;
  }

  const players = Object.entries(game.players || {}).sort((a, b) => (b[1].score || 0) - (a[1].score || 0));
  const answerRows = Object.entries(round?.answers || {}).map(([id, a]) => ({ id, player: game.players[id], answer: a.answer }));
  const winners = players.filter(([, p]) => p.role === 'player');
  const topScore = winners[0]?.[1]?.score || 0;

  return <main className="shell">
    <header className="topbar">
      <div><p className="eyebrow">Rohan's Mentality</p><h2>{game.status === 'ended' ? 'Final chaos report' : question || 'Lobby'}</h2></div>
      <div className="pill">You: {player.name} · {player.role}</div>
    </header>

    <section className="grid">
      <div className="card mainCard">
        {game.status === 'lobby' && <>
          <h3>Lobby</h3>
          <p>Need Admin, Rohan, and at least 1 player. Then the admin can start.</p>
          <div className="roster">{players.map(([id, p]) => <span key={id}>{p.role === 'rohan' ? '👑 ' : ''}{p.name} <small>{p.role}</small></span>)}</div>
          {player.role === 'admin' && <button className="primary" onClick={() => startRound(0)}>Start Game</button>}
        </>}

        {game.status === 'answering' && <>
          <div className="roundMeta"><span>Round {game.currentRound + 1}/{game.questions.length}</span><span className={secondsLeft < 10 ? 'danger' : ''}>{secondsLeft}s</span></div>
          <h1 className="question">{question}</h1>
          {(player.role === 'player' || player.role === 'rohan') ? <>
            <p className="instruction">Think like the herd if you want some points. Think like Rohan if you want to be the winner.</p>
            {submitted ? <div className="submitted">Answer locked. Let the herd panic.</div> : <>
              <input value={answer} onChange={e => setAnswer(e.target.value.slice(0, 100))} placeholder="Your answer under 100 characters" maxLength={100} />
              <div className="chars">{answer.length}/100</div>
              <button className="primary" onClick={() => submitAnswer()}>Submit Answer</button>
            </>}
          </> : <p>Admin view: waiting for answers.</p>}
          {player.role === 'admin' && <button onClick={revealRound}>Reveal Now</button>}
        </>}

        {game.status === 'reveal' && <>
          <div className="answerBanner"><div><small>HERD's Answer</small><strong>{round.herdAnswer || herdAnswer || 'No herd'}</strong></div><div><small>ROHAN's Answer</small><strong>{round.rohanAnswer || rohanAnswer || 'No answer'}</strong></div></div>
          <h3>All answers</h3>
          <div className="answers">{answerRows.map(row => <div className="answerRow" key={row.id}>
            <span><b>{row.player?.name}</b> <small>{row.player?.role}</small></span>
            <span>{row.answer}</span>
            {player.role === 'rohan' && row.player?.role === 'player' && !round.disqualified && <button className="tiny dangerBtn" onClick={() => disqualify(row.id)}>Disqualify -1</button>}
            {round.disqualified === row.id && <em>Disqualified by Rohan</em>}
          </div>)}</div>
          <h3>Rohan verdicts</h3>
          <div className="verdicts">{Object.entries(round.scoreDeltas || {}).map(([id, s]) => <p key={id}><b>{game.players[id]?.name}</b>: +{s.delta || 0}{s.dq ? ' -1 DQ' : ''} {(s.messages || []).join(' ') || 'Rohan says nothing. Awkward.'}</p>)}</div>
          {player.role === 'admin' && <div className="actions"><button className="primary" onClick={nextRound}>Next Round</button><button onClick={endGame}>End Game Early</button></div>}
        </>}

        {game.status === 'ended' && <>
          <h1>Winner: {winners.filter(([, p]) => (p.score || 0) === topScore).map(([, p]) => p.name).join(' + ') || 'Nobody'}</h1>
          <p className="instruction">Rohan has judged the herd. Some were exceptional. Some were just alright.</p>
          {player.role === 'admin' && <button className="dangerBtn" onClick={resetGame}>Reset Game</button>}
        </>}
      </div>

      <aside className="card scoreboard">
        <h3>Scoreboard</h3>
        {players.map(([id, p], i) => <div className="score" key={id}><span>{i + 1}. {p.name} <small>{p.role}</small></span><b>{p.role === 'player' ? p.score || 0 : '—'}</b></div>)}
        {player.role === 'admin' && game.status !== 'ended' && <button className="full dangerBtn" onClick={endGame}>End Game</button>}
      </aside>
    </section>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);

import { useState, useEffect, useRef } from 'react';
import { db } from './firebase.js';
import { ref, set, get, onValue, update, remove } from 'firebase/database';

// ─── QUESTIONS ───────────────────────────────────────────────────────────────
const QUESTIONS = [
  "What would Rohan order at a restaurant?",
  "What's the first thing Rohan would talk about at a party?",
  "Pick one word to describe Rohan.",
  "What movie would Rohan make everyone watch?",
  "What's Rohan's go-to drink?",
  "If Rohan had one free afternoon, how would he spend it?",
  "What dessert is Rohan most likely to order?",
  "Name a topic Rohan could lecture you on for an hour.",
  "What's something Rohan does that surprises people?",
  "Which city suits Rohan best — SF, Philly, New York, or Pune?",
  "What animal is Rohan most like?",
  "What is the first topic Rohan would bring up at a dinner party to start a debate?",
  "Name a tech company Rohan talks about the most (besides Meta).",
  "What's the one piece of tech Rohan owns that he's most proud of?",
  "Name a famous tech founder Rohan either loves or loves to roast.",
  "If Rohan got punched (again), what did he likely say right before it happened?",
  "If Rohan went to jail, what would the specific charge be?",
  "What's the most likely reason Rohan would get kicked out of a high-end restaurant?",
  "If Rohan became a 'cult leader,' what would the cult be centered around?",
  "Rohan's at a bar and gets into a heated argument with a stranger. What is the argument about?",
];

// ─── ANSWER GROUPING (AI) ────────────────────────────────────────────────────
async function groupAnswers(answers) {
  if (!answers || answers.length === 0) return {};
  const unique = [...new Set(answers.map(a => a.trim().toLowerCase()).filter(Boolean))];
  if (unique.length <= 1) return { [unique[0]]: unique };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: `You are grouping free-text answers from a party game. Your job is to find answers that refer to the same thing and group them. Be VERY lenient and generous — if there is any reasonable way to consider two answers the same, group them.

Grouping rules (apply all of these):
1. SUBSTRINGS: if one answer contains another, they're the same. "slice of pizza" contains "pizza" → same group. "a quick cricket match" contains "cricket" → same group.
2. SYNONYMS: rat, mouse, mice, rodent → same. arguing, debate, fight → same. drink, beverage, alcohol → same.
3. SLASH ALIASES: "facebook/meta/fc" means ALL of facebook, meta, fc, fb are equivalent answers.
4. ABBREVIATIONS & NICKNAMES: fb=facebook=meta, yt=youtube, ig=instagram, nyc=new york.
5. PARTIAL MATCH: any answer that is mostly about the same core noun groups together. "a pepperoni pizza", "pizza slice", "some pizza", "nyc pizza" → all "pizza".
6. ADJECTIVE+NOUN: strip adjectives/articles to find the core. "old whiskey", "a whiskey", "whiskey neat" → "whiskey".
7. ACTIVITY: "playing football", "football", "a game of football" → "football".
8. BRAND VARIANTS: different spellings, capitalisations, or common misspellings of the same brand → same group.

Answers to group: ${JSON.stringify(unique)}

Respond ONLY with a valid JSON object where every key is one of the given answers (lowercase, exactly as given) and its value is the canonical name for that group (choose the shortest, clearest form). No markdown, no extra text.` }]
      })
    });
    const data = await res.json();
    const text = data.content?.find(c => c.type === 'text')?.text || '{}';
    const mapping = JSON.parse(text.replace(/```json|```/g, '').trim());
    const groups = {};
    unique.forEach(a => {
      const canon = mapping[a] || a;
      if (!groups[canon]) groups[canon] = [];
      groups[canon].push(a);
    });
    return groups;
  } catch {
    const groups = {};
    unique.forEach(a => { groups[a] = [a]; });
    return groups;
  }
}

function getCanonical(raw, groups) {
  const lower = raw.trim().toLowerCase();
  for (const [canon, members] of Object.entries(groups)) {
    if (members.includes(lower)) return canon;
  }
  return lower;
}

function findHerd(playerAnswers, groups) {
  const counts = {};
  playerAnswers.forEach(raw => {
    const c = getCanonical(raw, groups);
    counts[c] = (counts[c] || 0) + 1;
  });
  let max = 0, herd = null;
  for (const [ans, n] of Object.entries(counts)) {
    if (n > max) { max = n; herd = ans; }
  }
  // Require a clear majority: at least 2 people and no tie at the top
  const tied = Object.values(counts).filter(n => n === max).length;
  if (max < 2 || tied > 1) return { herdAnswer: null, counts };
  return { herdAnswer: herd, counts };
}

// ─── SHARED STYLES ────────────────────────────────────────────────────────────
const S = {
  input: { background: '#111114', border: '1px solid #2e2e38', borderRadius: 8, padding: '10px 14px', color: '#f0f0f5', fontFamily: 'Syne, sans-serif', fontSize: '1rem', outline: 'none', width: '100%' },
  card: { background: '#1c1c22', border: '1px solid #2e2e38', borderRadius: 12, padding: '1.25rem 1.5rem', width: '100%', maxWidth: 580 },
  btnPrimary: { background: 'linear-gradient(135deg,#ff3c3c,#ff6b00)', border: 'none', borderRadius: 10, padding: '12px 28px', color: '#fff', fontFamily: '"Bebas Neue", sans-serif', fontSize: '1.2rem', letterSpacing: '0.08em', cursor: 'pointer', width: '100%' },
  btnGhost: { background: 'transparent', border: '1px solid #2e2e38', borderRadius: 8, padding: '8px 16px', color: '#9090a8', fontFamily: '"DM Mono", monospace', fontSize: '0.72rem', letterSpacing: '0.1em', cursor: 'pointer' },
  label: { fontFamily: '"DM Mono", monospace', fontSize: '0.65rem', color: '#5a5a72', letterSpacing: '0.18em', textTransform: 'uppercase' },
  page: { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '2rem', gap: '1.25rem', paddingTop: '2.5rem', position: 'relative' },
};

function roleColor(role) {
  return role === 'rohan' ? '#a855f7' : role === 'admin' ? '#ff3c3c' : '#22d3ee';
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState('join');
  const [playerName, setPlayerName] = useState('');
  const [playerRole, setPlayerRole] = useState('player');
  const [playerId] = useState(() => Math.random().toString(36).slice(2, 10));
  const [gameState, setGameState] = useState(null);
  const [nameInput, setNameInput] = useState('');
  const [roleInput, setRoleInput] = useState('player');
  const [joinError, setJoinError] = useState('');
  const [myAnswer, setMyAnswer] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [timerLeft, setTimerLeft] = useState(null);
  const [hasDisqualified, setHasDisqualified] = useState(false);
  const [timerSetup, setTimerSetup] = useState(60);
  const timerRef = useRef(null);
  const prevRound = useRef(null);
  const isRevealingRef = useRef(false); // prevents double-trigger

  // Live sync
  useEffect(() => {
    const unsub = onValue(ref(db, 'game'), snap => setGameState(snap.val()));
    return () => unsub();
  }, []);

  // Phase changes
  useEffect(() => {
    if (!gameState) return;
    const { phase, currentRound } = gameState;
    if (phase === 'setup') { if (playerRole === 'admin') setScreen('setup'); }
    else if (phase === 'lobby') setScreen('lobby');
    else if (phase === 'answer') {
      if (currentRound !== prevRound.current) { setMyAnswer(''); setSubmitted(false); setHasDisqualified(false); isRevealingRef.current = false; }
      setScreen('answer');
    }
    else if (phase === 'reveal') setScreen('reveal');
    else if (phase === 'end') setScreen('end');
    prevRound.current = currentRound;
  }, [gameState?.phase, gameState?.currentRound]);

  // Keep a ref to playerRole so timer callback always sees current value
  const playerRoleRef = useRef(playerRole);
  useEffect(() => { playerRoleRef.current = playerRole; }, [playerRole]);
  const submittedRef = useRef(submitted);
  useEffect(() => { submittedRef.current = submitted; }, [submitted]);

  // Timer — admin doesn't submit answers, only triggers reveal
  useEffect(() => {
    clearInterval(timerRef.current);
    if (!gameState || gameState.phase !== 'answer' || !gameState.timerEnd) return;
    const endTime = gameState.timerEnd;
    const tick = () => {
      const left = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      setTimerLeft(left);
      if (left <= 0) {
        clearInterval(timerRef.current);
        if (playerRoleRef.current === 'admin') {
          if (!isRevealingRef.current) { isRevealingRef.current = true; triggerReveal(); }
        } else if (!submittedRef.current && playerName) {
          doSubmit(myAnswer || '(no answer)');
        }
      }
    };
    tick();
    timerRef.current = setInterval(tick, 500);
    return () => clearInterval(timerRef.current);
  }, [gameState?.timerEnd, gameState?.phase]);

  const endGame = () => { if (confirm('End game now?')) update(ref(db, 'game'), { phase: 'end' }); };

  // Force-wipe stale game and create fresh (admin only, emergency use)
  const forceCreate = async () => {
    const name = nameInput.trim();
    if (!name) return setJoinError('Enter your name first!');
    if (!confirm('This will DELETE the current game and start fresh. Sure?')) return;
    const p = { id: playerId, name, role: 'admin', joinedAt: Date.now() };
    await set(ref(db, 'game'), { phase: 'setup', players: { [playerId]: p }, scores: {}, timerSeconds: 60, questions: QUESTIONS, currentRound: 0 });
    setPlayerName(name);
    setPlayerRole('admin');
    setScreen('setup');
  };

  // JOIN
  const handleJoin = async () => {
    const name = nameInput.trim();
    if (!name) return setJoinError('Enter your name!');
    const snap = await get(ref(db, 'game'));
    let data = snap.val();

    // Auto-clear stale games for admin:
    // 1. Game is in 'end' phase (someone forgot to reset)
    // 2. Game is older than 12 hours (abandoned session)
    if (roleInput === 'admin' && data) {
      const isEnded = data.phase === 'end';
      const isStale = data.createdAt && (Date.now() - data.createdAt > 12 * 60 * 60 * 1000);
      if (isEnded || isStale) {
        await remove(ref(db, 'game'));
        data = null;
      }
    }

    if (!data && roleInput !== 'admin') return setJoinError('No game yet. Join as Admin to create one.');
    if (roleInput === 'rohan' && Object.values(data?.players || {}).some(p => p.role === 'rohan')) return setJoinError('Rohan has already joined!');
    if (roleInput === 'admin' && data && data.phase !== 'lobby' && data.phase !== 'setup') {
      return setJoinError('A game is already running. Ask the current admin to reset it, or use "Force Create" below.');
    }

    const p = { id: playerId, name, role: roleInput, joinedAt: Date.now() };
    if (roleInput === 'admin' && !data) {
      // Fresh game
      await set(ref(db, 'game'), { phase: 'setup', players: { [playerId]: p }, scores: {}, timerSeconds: 60, questions: QUESTIONS, currentRound: 0, createdAt: Date.now() });
      setScreen('setup');
    } else if (roleInput === 'admin' && data && (data.phase === 'lobby' || data.phase === 'setup')) {
      // Admin rejoining an existing lobby/setup
      await update(ref(db, `game/players/${playerId}`), p);
      setScreen(data.phase === 'setup' ? 'setup' : 'lobby');
    } else {
      await update(ref(db, `game/players/${playerId}`), p);
      if (roleInput !== 'admin') await update(ref(db, `game/scores`), { [playerId]: 0 });
      setScreen('lobby');
    }
    setPlayerName(name);
    setPlayerRole(roleInput);
  };

  // ADMIN: confirm setup
  const handleSetupDone = async () => {
    await update(ref(db, 'game'), { timerSeconds: timerSetup, phase: 'lobby' });
    setScreen('lobby');
  };

  // ADMIN: start game
  const handleStart = async () => {
    const snap = await get(ref(db, 'game'));
    const data = snap.val();
    const ps = Object.values(data.players || {});
    if (!ps.some(p => p.role === 'rohan')) return alert('Waiting for Rohan to join!');
    if (!ps.some(p => p.role === 'player')) return alert('Need at least 1 player!');
    await startRound(0, data.timerSeconds);
  };

  const startRound = async (idx, secs) => {
    await update(ref(db, 'game'), {
      phase: 'answer', currentRound: idx, timerEnd: Date.now() + secs * 1000,
      currentAnswers: null, disqualified: null, groupedAnswers: null,
      herdAnswer: null, rohanAnswer: null, pointsThisRound: null,
    });
  };

  // SUBMIT ANSWER — admin never calls this
  const doSubmit = async (text) => {
    if (submitted || playerRole === 'admin') return;
    const answer = (text || '').trim().slice(0, 100) || '(no answer)';
    setSubmitted(true);
    await update(ref(db, `game/currentAnswers/${playerId}`), { playerId, playerName, role: playerRole, answer });
  };

  // REVEAL — guarded so it can only fire once per round
  const triggerReveal = async () => {
    if (isRevealingRef.current) return;
    isRevealingRef.current = true;
    const snap = await get(ref(db, 'game'));
    const data = snap.val();
    const answers = data.currentAnswers || {};
    const rohanEntry = Object.values(answers).find(a => a.role === 'rohan');
    const playerAnswers = Object.values(answers).filter(a => a.role !== 'rohan');
    const rohanRaw = rohanEntry?.answer || '';
    const allTexts = Object.values(answers).map(a => a.answer);
    const groups = await groupAnswers(allTexts);
    const { herdAnswer } = findHerd(playerAnswers.map(a => a.answer), groups);
    const rohanCanon = getCanonical(rohanRaw, groups);
    const newScores = { ...data.scores };
    const pointsThisRound = {};
    Object.values(answers).forEach(entry => {
      if (entry.role === 'rohan') return;
      const canon = getCanonical(entry.answer, groups);
      let pts = 0;
      if (herdAnswer && canon === herdAnswer) pts += 2;
      if (rohanCanon && canon === rohanCanon) pts += 5;
      pointsThisRound[entry.playerId] = { pts, answer: entry.answer, canon };
      newScores[entry.playerId] = (newScores[entry.playerId] || 0) + pts;
    });
    await update(ref(db, 'game'), { phase: 'reveal', groupedAnswers: groups, herdAnswer: herdAnswer || '', rohanAnswer: rohanRaw, rohanCanon, pointsThisRound, scores: newScores, disqualified: null });
  };

  // RECOMPUTE POINTS when admin changes herd answer
  const recomputePoints = async (newHerdAnswer) => {
    const snap = await get(ref(db, 'game'));
    const data = snap.val();
    const answers = data.currentAnswers || {};
    const groups = data.groupedAnswers || {};
    const rohanCanon = data.rohanCanon || '';
    // Rebuild scores from scratch for this round
    const baseScores = { ...data.scores };
    const oldPoints = data.pointsThisRound || {};
    // Subtract old round points first
    Object.entries(oldPoints).forEach(([pid, { pts }]) => {
      baseScores[pid] = (baseScores[pid] || 0) - pts;
    });
    // Also undo disqualification if any
    if (data.disqualified) {
      baseScores[data.disqualified] = (baseScores[data.disqualified] || 0) + 1;
    }
    const newPoints = {};
    const newScores = { ...baseScores };
    Object.values(answers).forEach(entry => {
      if (entry.role === 'rohan' || entry.role === 'admin') return;
      const canon = getCanonical(entry.answer, groups);
      let pts = 0;
      if (newHerdAnswer && canon === newHerdAnswer) pts += 2;
      if (rohanCanon && canon === rohanCanon) pts += 5;
      newPoints[entry.playerId] = { pts, answer: entry.answer, canon };
      newScores[entry.playerId] = (newScores[entry.playerId] || 0) + pts;
    });
    // Re-apply disqualification
    if (data.disqualified) {
      newScores[data.disqualified] = (newScores[data.disqualified] || 0) - 1;
    }
    await update(ref(db, 'game'), { herdAnswer: newHerdAnswer || '', pointsThisRound: newPoints, scores: newScores });
  };

  // ADJUST individual player score
  const adjustScore = async (targetPlayerId, delta) => {
    const snap = await get(ref(db, 'game'));
    const data = snap.val();
    const newScores = { ...data.scores };
    newScores[targetPlayerId] = (newScores[targetPlayerId] || 0) + delta;
    await update(ref(db, 'game'), { scores: newScores });
  };

  // DISQUALIFY
  const handleDisqualify = async (targetId) => {
    if (hasDisqualified || gameState.disqualified) return;
    setHasDisqualified(true);
    const newScores = { ...gameState.scores };
    newScores[targetId] = (newScores[targetId] || 0) - 1;
    await update(ref(db, 'game'), { disqualified: targetId, scores: newScores });
  };

  // NEXT ROUND
  const handleNext = async () => {
    const snap = await get(ref(db, 'game'));
    const data = snap.val();
    const next = (data.currentRound || 0) + 1;
    if (next >= QUESTIONS.length) await update(ref(db, 'game'), { phase: 'end' });
    else await startRound(next, data.timerSeconds);
  };

  // SKIP QUESTION — admin only, jumps to next round without reveal
  const handleSkip = async () => {
    if (!confirm('Skip this question? No points awarded for this round.')) return;
    isRevealingRef.current = true; // prevent timer from triggering reveal
    clearInterval(timerRef.current);
    const snap = await get(ref(db, 'game'));
    const data = snap.val();
    const next = (data.currentRound || 0) + 1;
    if (next >= QUESTIONS.length) await update(ref(db, 'game'), { phase: 'end' });
    else await startRound(next, data.timerSeconds);
  };

  // RESET
  const handleReset = async () => {
    if (confirm('Reset everything?')) { await remove(ref(db, 'game')); setScreen('join'); setPlayerName(''); setMyAnswer(''); setSubmitted(false); }
  };

  const isAdmin = playerRole === 'admin';
  const isRohan = playerRole === 'rohan';
  const gs = gameState;
  const q = gs?.questions?.[gs?.currentRound] || '';
  const players = gs?.players || {};
  const scores = gs?.scores || {};

  // ── RENDER ─────────────────────────────────────────────────────────────────

  if (!playerName || screen === 'join') return <JoinScreen {...{ nameInput, setNameInput, roleInput, setRoleInput, joinError, handleJoin, gameExists: !!gs, forceCreate }} />;
  if (screen === 'setup') return <SetupScreen timerSetup={timerSetup} setTimerSetup={setTimerSetup} onDone={handleSetupDone} />;
  if (!gs) return <Waiting msg="Connecting..." />;
  if (screen === 'lobby') return <LobbyScreen players={players} playerName={playerName} isAdmin={isAdmin} onStart={handleStart} timerSeconds={gs.timerSeconds} />;

  if (screen === 'answer') return (
    <AnswerScreen
      question={q} round={gs.currentRound} total={QUESTIONS.length}
      timerLeft={timerLeft} timerTotal={gs.timerSeconds}
      myAnswer={myAnswer} setMyAnswer={setMyAnswer} submitted={submitted}
      onSubmit={() => doSubmit(myAnswer)} players={players}
      currentAnswers={gs.currentAnswers || {}} isAdmin={isAdmin}
      onForceReveal={() => { if (!isRevealingRef.current) { isRevealingRef.current = true; triggerReveal(); } }}
      onSkip={handleSkip}
      onEnd={endGame} playerRole={playerRole}
    />
  );

  if (screen === 'reveal') return (
    <RevealScreen
      question={q} round={gs.currentRound} total={QUESTIONS.length}
      players={players} answers={gs.currentAnswers || {}}
      herdAnswer={gs.herdAnswer} rohanAnswer={gs.rohanAnswer} rohanCanon={gs.rohanCanon}
      groupedAnswers={gs.groupedAnswers || {}}
      points={gs.pointsThisRound || {}} scores={scores}
      disqualified={gs.disqualified} playerId={playerId}
      isAdmin={isAdmin} isRohan={isRohan}
      hasDisqualified={hasDisqualified} onDisqualify={handleDisqualify}
      onRecomputePoints={recomputePoints} onAdjustScore={adjustScore}
      onNext={handleNext} isLast={(gs.currentRound || 0) + 1 >= QUESTIONS.length}
      onEnd={endGame}
    />
  );

  if (screen === 'end' || gs.phase === 'end') return (
    <EndScreen players={players} scores={scores} isAdmin={isAdmin} onReset={handleReset} playerName={playerName} />
  );

  return <Waiting msg="Loading..." />;
}

// ─── JOIN SCREEN ──────────────────────────────────────────────────────────────
function JoinScreen({ nameInput, setNameInput, roleInput, setRoleInput, joinError, handleJoin, gameExists, forceCreate }) {
  const roleDescs = { player: 'Think like the herd, or think like Rohan.', admin: 'You control the game. Create & manage rounds.', rohan: 'You ARE Rohan. Your answer sets the benchmark.' };
  return (
    <div style={{ ...S.page, justifyContent: 'center' }}>
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse 80% 40% at 50% 0%,rgba(255,60,60,0.1) 0%,transparent 65%)' }} />
      <div style={{ textAlign: 'center', zIndex: 1 }}>
        <div style={{ fontFamily: '"Bebas Neue",sans-serif', fontSize: 'clamp(3rem,10vw,6rem)', lineHeight: 1, background: 'linear-gradient(135deg,#ff3c3c,#ffaa00,#a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>ROHAN'S<br />MENTALITY</div>
        <div style={{ ...S.label, marginTop: 6 }}>a herd mentality party game</div>
      </div>
      <div style={{ ...S.card, maxWidth: 400, display: 'flex', flexDirection: 'column', gap: '1rem', zIndex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: '1rem' }}>Enter the Arena</div>
        <input style={S.input} placeholder="Your name" value={nameInput} onChange={e => setNameInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleJoin()} autoFocus />
        <div>
          <div style={{ ...S.label, marginBottom: 7 }}>Join as</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {['player', 'admin', 'rohan'].map(r => (
              <button key={r} onClick={() => setRoleInput(r)} style={{ flex: 1, padding: '8px 4px', borderRadius: 8, border: `2px solid ${roleInput === r ? roleColor(r) : '#2e2e38'}`, background: roleInput === r ? `${roleColor(r)}18` : 'transparent', color: roleInput === r ? roleColor(r) : '#5a5a72', fontFamily: '"DM Mono",monospace', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer' }}>
                {r === 'rohan' ? '🎯 Rohan' : r === 'admin' ? '⚡ Admin' : '🎮 Player'}
              </button>
            ))}
          </div>
          <div style={{ fontFamily: '"DM Mono",monospace', fontSize: '0.65rem', color: '#5a5a72', marginTop: 6 }}>{roleDescs[roleInput]}</div>
        </div>
        {joinError && <div style={{ color: '#ef4444', fontFamily: '"DM Mono",monospace', fontSize: '0.72rem', padding: '8px 10px', background: 'rgba(239,68,68,0.08)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)' }}>⚠ {joinError}</div>}
        {joinError && roleInput === 'admin' && (
          <button style={{ ...S.btnGhost, color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)', width: '100%', padding: '10px' }} onClick={forceCreate}>
            ⚠ FORCE CREATE NEW GAME (wipes existing)
          </button>
        )}
        <button style={S.btnPrimary} onClick={handleJoin}>{roleInput === 'admin' && !gameExists ? 'CREATE GAME' : 'JOIN GAME'}</button>
      </div>
      <div style={{ ...S.label, textAlign: 'center', zIndex: 1 }}>Need: 1 Admin · 1 Rohan · 1+ Players</div>
    </div>
  );
}

// ─── SETUP SCREEN ─────────────────────────────────────────────────────────────
function SetupScreen({ timerSetup, setTimerSetup, onDone }) {
  const opts = [{ v: 30, l: '30s', d: 'Lightning fast' }, { v: 60, l: '60s', d: 'Balanced' }, { v: 90, l: '90s', d: 'Relaxed' }, { v: 120, l: '2min', d: 'Take your time' }];
  return (
    <div style={{ ...S.page, justifyContent: 'center' }}>
      <div style={{ fontFamily: '"Bebas Neue",sans-serif', fontSize: '3.5rem', color: '#ff3c3c', letterSpacing: '0.05em', textAlign: 'center' }}>GAME SETUP</div>
      <div style={{ ...S.card, maxWidth: 420, display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div>
          <div style={{ ...S.label, marginBottom: 10 }}>Answer Timer</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {opts.map(o => (
              <button key={o.v} onClick={() => setTimerSetup(o.v)} style={{ padding: '1rem', borderRadius: 10, border: `2px solid ${timerSetup === o.v ? '#ff3c3c' : '#2e2e38'}`, background: timerSetup === o.v ? 'rgba(255,60,60,0.1)' : '#111114', cursor: 'pointer', textAlign: 'left' }}>
                <div style={{ fontFamily: '"Bebas Neue",sans-serif', fontSize: '2rem', color: timerSetup === o.v ? '#ff3c3c' : '#f0f0f5' }}>{o.l}</div>
                <div style={{ fontFamily: '"DM Mono",monospace', fontSize: '0.65rem', color: '#5a5a72' }}>{o.d}</div>
              </button>
            ))}
          </div>
        </div>
        <div style={{ padding: '1rem', background: '#111114', borderRadius: 10, border: '1px solid #2e2e38', fontFamily: '"DM Mono",monospace', fontSize: '0.72rem', color: '#9090a8', lineHeight: 1.7 }}>
          <div style={{ color: '#ffd700', marginBottom: 6 }}>📋 Scoring</div>
          <div>⚡ +2 pts — match the herd</div>
          <div>👑 +5 pts — match Rohan's answer</div>
          <div>💀 −1 pt — Rohan disqualifies you</div>
          <div style={{ color: '#5a5a72', marginTop: 6 }}>Rohan doesn't compete for points.</div>
        </div>
        <button style={S.btnPrimary} onClick={onDone}>OPEN LOBBY →</button>
      </div>
    </div>
  );
}

// ─── LOBBY SCREEN ─────────────────────────────────────────────────────────────
function LobbyScreen({ players, playerName, isAdmin, onStart, timerSeconds }) {
  const list = Object.values(players).sort((a, b) => a.joinedAt - b.joinedAt);
  const hasRohan = list.some(p => p.role === 'rohan');
  const hasPlayer = list.some(p => p.role === 'player');
  const canStart = hasRohan && hasPlayer;
  return (
    <div style={S.page}>
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse 60% 40% at 50% 0%,rgba(168,85,247,0.07) 0%,transparent 60%)' }} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: '"Bebas Neue",sans-serif', fontSize: 'clamp(2.5rem,8vw,4.5rem)', letterSpacing: '0.03em' }}>WAITING ROOM</div>
        <div style={{ ...S.label, marginTop: 4 }}>{timerSeconds}s per round · {list.length} joined</div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        {[['Admin', list.some(p => p.role === 'admin'), '#ff3c3c'], ['Rohan', hasRohan, '#a855f7'], ['1+ Player', hasPlayer, '#22d3ee']].map(([l, ok, c]) => (
          <div key={l} style={{ padding: '4px 12px', borderRadius: 100, border: `1px solid ${ok ? c : '#2e2e38'}`, background: ok ? `${c}15` : 'transparent', fontFamily: '"DM Mono",monospace', fontSize: '0.68rem', color: ok ? c : '#5a5a72', letterSpacing: '0.1em' }}>
            {ok ? '✓' : '○'} {l}
          </div>
        ))}
      </div>
      <div style={{ width: '100%', maxWidth: 500, display: 'flex', flexDirection: 'column', gap: 7 }}>
        {list.map(p => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', background: '#1c1c22', border: `1px solid ${p.name === playerName ? roleColor(p.role) + '55' : '#2e2e38'}`, borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: `${roleColor(p.role)}18`, border: `2px solid ${roleColor(p.role)}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Bebas Neue",sans-serif', color: roleColor(p.role), fontSize: '0.9rem' }}>{p.name[0]?.toUpperCase()}</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{p.name} {p.name === playerName && <span style={{ color: '#5a5a72', fontWeight: 400, fontSize: '0.78rem' }}>(you)</span>}</div>
                <div style={{ fontFamily: '"DM Mono",monospace', fontSize: '0.6rem', color: roleColor(p.role), textTransform: 'uppercase', letterSpacing: '0.1em' }}>{p.role}</div>
              </div>
            </div>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 5px #22c55e' }} />
          </div>
        ))}
      </div>
      {isAdmin
        ? <button onClick={onStart} disabled={!canStart} style={{ ...S.btnPrimary, maxWidth: 500, opacity: canStart ? 1 : 0.4, cursor: canStart ? 'pointer' : 'not-allowed' }}>{canStart ? '⚡ START GAME' : 'WAITING FOR PLAYERS...'}</button>
        : <div style={{ fontFamily: '"DM Mono",monospace', fontSize: '0.8rem', color: '#5a5a72' }}>Waiting for admin to start...</div>
      }
    </div>
  );
}

// ─── ANSWER SCREEN ────────────────────────────────────────────────────────────
function AnswerScreen({ question, round, total, timerLeft, timerTotal, myAnswer, setMyAnswer, submitted, onSubmit, players, currentAnswers, isAdmin, onForceReveal, onSkip, onEnd, playerRole }) {
  const pct = timerTotal > 0 ? Math.max(0, (timerLeft || 0) / timerTotal) : 0;
  const circ = 2 * Math.PI * 42;
  const timerColor = (timerLeft || 0) > 20 ? '#22c55e' : (timerLeft || 0) > 10 ? '#ffaa00' : '#ef4444';
  return (
    <div style={S.page}>
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse 70% 40% at 50% 0%,rgba(255,60,60,0.07) 0%,transparent 60%)' }} />
      <div style={{ width: '100%', maxWidth: 580, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={S.label}>Round {round + 1} / {total}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={S.label}>{Object.keys(currentAnswers).length}/{Object.values(players).filter(p=>p.role!=='admin').length} in</div>
          {isAdmin && <button style={S.btnGhost} onClick={onEnd}>END GAME</button>}
        </div>
      </div>
      <div style={{ position: 'relative' }}>
        <svg width="100" height="100" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="50" cy="50" r="42" fill="none" stroke="#1c1c22" strokeWidth="6" />
          <circle cx="50" cy="50" r="42" fill="none" stroke={timerColor} strokeWidth="6" strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)} strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.5s linear, stroke 0.5s' }} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontFamily: '"Bebas Neue",sans-serif', fontSize: '1.8rem', color: timerColor, lineHeight: 1 }}>{timerLeft ?? '—'}</div>
          <div style={{ ...S.label, fontSize: '0.5rem' }}>SECS</div>
        </div>
      </div>
      <div style={S.card}>
        <div style={{ ...S.label, color: '#ff3c3c', marginBottom: 8 }}>Question {round + 1}</div>
        <div style={{ fontWeight: 700, fontSize: 'clamp(1.05rem,3vw,1.3rem)', lineHeight: 1.4 }}>{question}</div>
      </div>
      <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
        <div style={{ fontFamily: '"DM Mono",monospace', fontSize: '0.7rem', color: '#ffaa00', textAlign: 'center', padding: '8px 12px', background: 'rgba(255,170,0,0.06)', borderRadius: 8, border: '1px solid rgba(255,170,0,0.15)', lineHeight: 1.6, whiteSpace: 'pre-line' }}>
          {playerRole === 'rohan' ? '👑 You are Rohan. Your answer sets the benchmark.' : 'Think like the herd if you want some points.\nThink like Rohan if you want to be the winner.'}
        </div>
        {submitted
          ? <div style={{ padding: '12px 16px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 8, color: '#22c55e', fontWeight: 600, textAlign: 'center' }}>✓ Locked in: <span style={{ color: '#f0f0f5' }}>{myAnswer || '(no answer)'}</span></div>
          : <>
            <div style={{ position: 'relative' }}>
              <input style={{ ...S.input, paddingRight: 52 }} placeholder="Type your answer..." value={myAnswer} onChange={e => setMyAnswer(e.target.value.slice(0, 100))} onKeyDown={e => e.key === 'Enter' && onSubmit()} autoFocus />
              <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontFamily: '"DM Mono",monospace', fontSize: '0.62rem', color: myAnswer.length >= 90 ? '#ef4444' : '#5a5a72' }}>{myAnswer.length}/100</span>
            </div>
            <button style={{ ...S.btnPrimary, opacity: myAnswer.trim() ? 1 : 0.4 }} onClick={onSubmit} disabled={!myAnswer.trim()}>LOCK IT IN</button>
          </>
        }
      </div>
      <div style={{ width: '100%', maxWidth: 580 }}>
        <div style={{ ...S.label, marginBottom: 7 }}>Players in</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {Object.values(players).map(p => {
            const done = !!currentAnswers[p.id];
            return <div key={p.id} style={{ padding: '4px 12px', borderRadius: 100, border: `1px solid ${done ? 'rgba(34,197,94,0.35)' : '#2e2e38'}`, background: done ? 'rgba(34,197,94,0.08)' : 'transparent', fontFamily: '"DM Mono",monospace', fontSize: '0.65rem', color: done ? '#22c55e' : '#5a5a72' }}>{done ? '✓' : '○'} {p.name}</div>;
          })}
        </div>
      </div>
      {isAdmin && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...S.btnGhost, color: '#22d3ee', borderColor: 'rgba(34,211,238,0.35)' }} onClick={onForceReveal}>FORCE REVEAL →</button>
          <button style={{ ...S.btnGhost, color: '#ffaa00', borderColor: 'rgba(255,170,0,0.35)' }} onClick={onSkip}>SKIP QUESTION ⏭</button>
        </div>
      )}
    </div>
  );
}

// ─── STANDINGS EDITOR ────────────────────────────────────────────────────────
// Admin edits scores locally, then hits "Apply" — ranks only update on submit
function StandingsEditor({ leaderboard, scores, playerId, isAdmin, onAdjustScore }) {
  const [localScores, setLocalScores] = useState(null);
  const [dirty, setDirty] = useState(false);

  // Initialise local scores from props, but only if admin hasn't started editing
  const displayed = localScores || scores;

  // Sort by local scores while editing, by real scores otherwise
  const sorted = [...leaderboard].sort((a, b) => (displayed[b.id] || 0) - (displayed[a.id] || 0));

  const adjust = (pid, delta) => {
    if (!isAdmin) return;
    const base = localScores || { ...scores };
    setLocalScores({ ...base, [pid]: (base[pid] || 0) + delta });
    setDirty(true);
  };

  const handleApply = async () => {
    if (!localScores) return;
    // Diff against real scores and apply each change
    const pids = Object.keys(localScores);
    for (const pid of pids) {
      const delta = (localScores[pid] || 0) - (scores[pid] || 0);
      if (delta !== 0) await onAdjustScore(pid, delta);
    }
    setLocalScores(null);
    setDirty(false);
  };

  const handleCancel = () => { setLocalScores(null); setDirty(false); };

  return (
    <div style={{ ...S.card, maxWidth: 640 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={S.label}>Standings</div>
        {isAdmin && dirty && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={handleCancel} style={{ ...S.btnGhost, padding: '4px 10px', fontSize: '0.65rem' }}>Cancel</button>
            <button onClick={handleApply} style={{ ...S.btnGhost, padding: '4px 10px', fontSize: '0.65rem', color: '#22c55e', borderColor: 'rgba(34,197,94,0.35)' }}>✓ Apply</button>
          </div>
        )}
        {isAdmin && !dirty && <div style={{ fontFamily: '"DM Mono",monospace', fontSize: '0.6rem', color: '#5a5a72' }}>⚡ use ± to edit, then apply</div>}
      </div>
      {sorted.map((p, i) => (
        <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: i === 0 ? 'rgba(255,215,0,0.05)' : 'transparent', border: `1px solid ${i === 0 ? 'rgba(255,215,0,0.15)' : 'transparent'}`, borderRadius: 8, marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontFamily: '"Bebas Neue",sans-serif', fontSize: '1rem', color: i === 0 ? '#ffd700' : i === 1 ? '#9090a8' : '#5a5a72', width: 20, textAlign: 'center' }}>{i + 1}</div>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', color: p.id === playerId ? '#ff3c3c' : '#f0f0f5' }}>{p.name}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isAdmin && (
              <button onClick={() => adjust(p.id, -1)} style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #2e2e38', background: 'transparent', color: '#9090a8', cursor: 'pointer', fontFamily: '"Bebas Neue",sans-serif', fontSize: '1.1rem', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
            )}
            <div style={{ fontFamily: '"Bebas Neue",sans-serif', fontSize: '1.3rem', color: dirty ? (localScores?.[p.id] !== scores[p.id] ? '#ffaa00' : '#f0f0f5') : (i === 0 ? '#ffd700' : '#f0f0f5'), minWidth: 28, textAlign: 'center' }}>{displayed[p.id] || 0}</div>
            {isAdmin && (
              <button onClick={() => adjust(p.id, +1)} style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #2e2e38', background: 'transparent', color: '#9090a8', cursor: 'pointer', fontFamily: '"Bebas Neue",sans-serif', fontSize: '1.1rem', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── REVEAL SCREEN ────────────────────────────────────────────────────────────
function RevealScreen({ question, round, total, players, answers, herdAnswer, rohanAnswer, rohanCanon, groupedAnswers, points, scores, disqualified, playerId, isAdmin, isRohan, hasDisqualified, onDisqualify, onRecomputePoints, onAdjustScore, onNext, isLast, onEnd }) {
  const nonRohan = Object.values(answers).filter(a => a.role !== 'rohan' && a.role !== 'admin').sort((a, b) => (points[b.playerId]?.pts || 0) - (points[a.playerId]?.pts || 0));
  const rohanEntry = Object.values(answers).find(a => a.role === 'rohan');
  const leaderboard = Object.values(players).filter(p => p.role !== 'rohan' && p.role !== 'admin').sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0));

  // All canonical groups available to pick as herd answer
  const canonicalOptions = Object.keys(groupedAnswers || {});

  const msg = (pts) => {
    if (pts >= 7) return { text: "Rohan says you are LEGENDARY. 🔥", c: '#ffd700' };
    if (pts >= 5) return { text: "Rohan says you are exceptional. 👑", c: '#a855f7' };
    if (pts >= 2) return { text: "Rohan says you're just alright. 🤷", c: '#22d3ee' };
    return { text: "Rohan doesn't know you. 💀", c: '#5a5a72' };
  };

  return (
    <div style={S.page}>
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse 60% 40% at 50% -5%,rgba(168,85,247,0.1) 0%,transparent 65%)' }} />
      <div style={{ width: '100%', maxWidth: 640, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={S.label}>Round {round + 1} · Results</div>
        {isAdmin && <button style={S.btnGhost} onClick={onEnd}>END GAME</button>}
      </div>
      <div style={{ ...S.card, maxWidth: 640 }}>
        <div style={{ ...S.label, color: '#ff3c3c', marginBottom: 6 }}>The Question</div>
        <div style={{ fontWeight: 700, fontSize: 'clamp(1rem,2.5vw,1.2rem)' }}>{question}</div>
      </div>

      {/* Herd + Rohan answer cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, width: '100%', maxWidth: 640 }}>
        {/* Herd card — admin gets a dropdown to override */}
        <div style={{ background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.3)', borderRadius: 12, padding: '1.1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 14 }}>🐟</span>
            <div style={{ fontFamily: '"DM Mono",monospace', fontSize: '0.58rem', color: '#22d3ee', letterSpacing: '0.15em', textTransform: 'uppercase' }}>Herd's Answer</div>
          </div>
          {isAdmin && canonicalOptions.length > 0 ? (
            <select
              value={herdAnswer || ''}
              onChange={e => onRecomputePoints(e.target.value || null)}
              style={{ background: '#111114', border: '1px solid rgba(34,211,238,0.4)', borderRadius: 6, color: '#f0f0f5', fontFamily: '"Syne",sans-serif', fontWeight: 800, fontSize: '0.95rem', padding: '4px 6px', width: '100%', cursor: 'pointer', marginBottom: 4 }}
            >
              <option value="">Y'all UNIQUE af (no herd)</option>
              {canonicalOptions.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          ) : (
            <div style={{ fontWeight: 800, fontSize: 'clamp(1rem,2.5vw,1.25rem)', wordBreak: 'break-word' }}>{herdAnswer || "Y'all UNIQUE af"}</div>
          )}
          <div style={{ fontFamily: '"DM Mono",monospace', fontSize: '0.58rem', color: 'rgba(34,211,238,0.6)', marginTop: 4 }}>
            {herdAnswer ? '+2 pts to matches' : 'no herd points this round'}
            {isAdmin && <span style={{ color: 'rgba(34,211,238,0.4)', marginLeft: 6 }}>← admin can override</span>}
          </div>
        </div>
        {/* Rohan card */}
        <div style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 12, padding: '1.1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 14 }}>👑</span>
            <div style={{ fontFamily: '"DM Mono",monospace', fontSize: '0.58rem', color: '#a855f7', letterSpacing: '0.15em', textTransform: 'uppercase' }}>Rohan's Answer</div>
          </div>
          <div style={{ fontWeight: 800, fontSize: 'clamp(1rem,2.5vw,1.25rem)', wordBreak: 'break-word' }}>{rohanEntry?.answer || rohanAnswer || '—'}</div>
          <div style={{ fontFamily: '"DM Mono",monospace', fontSize: '0.58rem', color: 'rgba(168,85,247,0.6)', marginTop: 4 }}>+5 pts to matches</div>
        </div>
      </div>

      {/* All answers */}
      <div style={{ width: '100%', maxWidth: 640 }}>
        <div style={{ ...S.label, marginBottom: 8 }}>All Answers</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {nonRohan.map((entry) => {
            const pts = points[entry.playerId]?.pts || 0;
            const isDisq = disqualified === entry.playerId;
            const isMe = entry.playerId === playerId;
            const m = msg(pts);
            return (
              <div key={entry.playerId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 14px', background: isMe ? 'rgba(255,60,60,0.05)' : '#1c1c22', border: `1px solid ${isMe ? 'rgba(255,60,60,0.3)' : isDisq ? 'rgba(239,68,68,0.3)' : '#2e2e38'}`, borderRadius: 10, opacity: isDisq ? 0.5 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: `${roleColor(entry.role)}15`, border: `1.5px solid ${roleColor(entry.role)}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Bebas Neue",sans-serif', fontSize: '0.85rem', color: roleColor(entry.role), flexShrink: 0 }}>{entry.playerName[0]?.toUpperCase()}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{entry.playerName} {isDisq && <span style={{ fontFamily: '"DM Mono",monospace', fontSize: '0.6rem', color: '#ef4444' }}>DISQUALIFIED −1</span>}</div>
                    <div style={{ fontSize: '0.88rem', color: '#9090a8', wordBreak: 'break-word' }}>{entry.answer}</div>
                    {pts >= 5 && <div style={{ fontFamily: '"DM Mono",monospace', fontSize: '0.6rem', color: '#a855f7', marginTop: 2 }}>👑 ROHAN MATCH</div>}
                    {(pts === 2 || pts === 7) && <div style={{ fontFamily: '"DM Mono",monospace', fontSize: '0.6rem', color: '#22d3ee', marginTop: 2 }}>🐟 HERD MATCH</div>}
                    <div style={{ fontFamily: '"DM Mono",monospace', fontSize: '0.6rem', color: m.c, marginTop: 2, fontStyle: 'italic' }}>{m.text}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontFamily: '"Bebas Neue",sans-serif', fontSize: '1.3rem', color: pts >= 5 ? '#a855f7' : pts > 0 ? '#22d3ee' : '#5a5a72', minWidth: 36, textAlign: 'right' }}>{pts > 0 ? `+${pts}` : '—'}</div>
                  {isRohan && !disqualified && !hasDisqualified && entry.playerId !== playerId && (
                    <button onClick={() => onDisqualify(entry.playerId)} style={{ ...S.btnGhost, color: '#ef4444', borderColor: 'rgba(239,68,68,0.35)', whiteSpace: 'nowrap', padding: '5px 9px', fontSize: '0.62rem' }}>DISQ −1</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Standings — admin gets editable score table with a submit button */}
      <StandingsEditor
        leaderboard={leaderboard}
        scores={scores}
        playerId={playerId}
        isAdmin={isAdmin}
        onAdjustScore={onAdjustScore}
      />

      {isRohan && <div style={{ fontFamily: '"DM Mono",monospace', fontSize: '0.72rem', color: disqualified ? '#a855f7' : '#5a5a72', padding: '8px 14px', background: 'rgba(168,85,247,0.07)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: 8 }}>{disqualified || hasDisqualified ? '👑 Disqualification applied.' : '👆 Tap DISQ −1 to penalise one player this round.'}</div>}
      {isAdmin
        ? <button style={{ ...S.btnPrimary, maxWidth: 640, marginBottom: '1rem' }} onClick={onNext}>{isLast ? 'SEE FINAL SCORES →' : 'NEXT ROUND →'}</button>
        : <div style={{ fontFamily: '"DM Mono",monospace', fontSize: '0.75rem', color: '#5a5a72', marginBottom: '1rem' }}>Waiting for admin to continue...</div>
      }
    </div>
  );
}

// ─── END SCREEN ───────────────────────────────────────────────────────────────
function EndScreen({ players, scores, isAdmin, onReset, playerName }) {
  const board = Object.values(players).filter(p => p.role !== 'rohan' && p.role !== 'admin').sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0));
  const winner = board[0];
  const verdicts = ["Rohan says: you might actually understand him. Scary. 🔥", "Rohan says: not bad. Not great either.", "Rohan says: you exist. That's something.", "Rohan says: who even are you? 👀"];
  return (
    <div style={S.page}>
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse 80% 60% at 50% 0%,rgba(255,215,0,0.09) 0%,transparent 60%)' }} />
      <div style={{ textAlign: 'center', zIndex: 1 }}>
        <div style={{ fontFamily: '"Bebas Neue",sans-serif', fontSize: 'clamp(3rem,10vw,5.5rem)', lineHeight: 1, background: 'linear-gradient(135deg,#ffd700,#ffaa00,#ff3c3c)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>GAME OVER</div>
        {winner && <div style={{ fontFamily: '"DM Mono",monospace', color: '#ffaa00', fontSize: '0.85rem', marginTop: 6, letterSpacing: '0.1em' }}>🏆 {winner.name} wins with {scores[winner.id] || 0} pts</div>}
      </div>
      {winner && (
        <div style={{ width: '100%', maxWidth: 480, background: 'linear-gradient(135deg,rgba(255,215,0,0.1),rgba(255,170,0,0.05))', border: '2px solid rgba(255,215,0,0.35)', borderRadius: 14, padding: '2rem', textAlign: 'center', zIndex: 1 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>👑</div>
          <div style={{ fontFamily: '"Bebas Neue",sans-serif', fontSize: 'clamp(2rem,6vw,3rem)', color: '#ffd700' }}>{winner.name}</div>
          <div style={{ fontFamily: '"Bebas Neue",sans-serif', fontSize: '1.3rem', color: '#9090a8', letterSpacing: '0.05em' }}>{scores[winner.id] || 0} POINTS</div>
          <div style={{ fontFamily: '"DM Mono",monospace', fontSize: '0.75rem', color: '#ffaa00', marginTop: 12, fontStyle: 'italic', lineHeight: 1.6 }}>{verdicts[0]}</div>
        </div>
      )}
      <div style={{ ...S.card, maxWidth: 480, zIndex: 1 }}>
        <div style={{ ...S.label, marginBottom: 12 }}>Final Standings</div>
        {board.map((p, i) => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: i === 0 ? 'rgba(255,215,0,0.05)' : p.name === playerName ? 'rgba(255,60,60,0.04)' : '#111114', border: `1px solid ${i === 0 ? 'rgba(255,215,0,0.2)' : p.name === playerName ? 'rgba(255,60,60,0.2)' : '#2e2e38'}`, borderRadius: 10, marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 18, width: 26, textAlign: 'center' }}>{['🥇', '🥈', '🥉'][i] || `#${i + 1}`}</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: i === 0 ? '#ffd700' : '#f0f0f5' }}>{p.name} {p.name === playerName && <span style={{ color: '#5a5a72', fontWeight: 400, fontSize: '0.78rem' }}>(you)</span>}</div>
                <div style={{ fontFamily: '"DM Mono",monospace', fontSize: '0.6rem', color: '#5a5a72', fontStyle: 'italic' }}>{verdicts[Math.min(i, verdicts.length - 1)]}</div>
              </div>
            </div>
            <div style={{ fontFamily: '"Bebas Neue",sans-serif', fontSize: '1.5rem', color: i === 0 ? '#ffd700' : '#f0f0f5' }}>{scores[p.id] || 0}</div>
          </div>
        ))}
      </div>
      {isAdmin
        ? <button style={{ ...S.btnPrimary, maxWidth: 480, zIndex: 1, background: 'transparent', border: '2px solid #2e2e38', color: '#9090a8', marginBottom: '2rem' }} onClick={onReset}>RESET GAME</button>
        : <div style={{ fontFamily: '"DM Mono",monospace', fontSize: '0.75rem', color: '#5a5a72', marginBottom: '2rem', zIndex: 1 }}>Thanks for playing Rohan's Mentality 🧠</div>
      }
    </div>
  );
}

// ─── WAITING ──────────────────────────────────────────────────────────────────
function Waiting({ msg }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <div style={{ fontFamily: '"Bebas Neue",sans-serif', fontSize: '2.5rem', color: '#ff3c3c' }}>···</div>
      <div style={{ fontFamily: '"DM Mono",monospace', color: '#5a5a72', fontSize: '0.75rem', letterSpacing: '0.15em' }}>{msg}</div>
    </div>
  );
}

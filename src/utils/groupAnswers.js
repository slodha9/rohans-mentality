// Smarter normalization + contextual grouping

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'his', 'her', 'with', 'at', 'in', 'on', 'for'
]);

const ANSWER_ALIASES = {
  nyc: 'new york',
  'new york city': 'new york',
  sf: 'san francisco',
  'san fran': 'san francisco',
  philly: 'philadelphia',

  fb: 'meta',
  facebook: 'meta',
  ig: 'instagram',
  insta: 'instagram',

  stocks: 'stock',
  shares: 'stock',
  equities: 'stock',
  equity: 'stock',

  investing: 'investment',
  investments: 'investment',
  investor: 'investment',

  arguing: 'argument',
  arguments: 'argument',
  debate: 'argument',

  crocheting: 'crochet'
};

function singularize(word) {
  if (word.length <= 3) return word;
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('es') && !word.endsWith('ses')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function normalizeAnswer(value = '') {
  const base = value
    .toLowerCase()
    .trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (ANSWER_ALIASES[base]) return ANSWER_ALIASES[base];

  const words = base
    .split(' ')
    .filter(Boolean)
    .filter(w => !STOP_WORDS.has(w))
    .map(w => ANSWER_ALIASES[w] || singularize(w));

  const phrase = words.join(' ').trim();
  return ANSWER_ALIASES[phrase] || phrase;
}

// Levenshtein distance
function editDistance(a, b) {
  if (a === b) return 0;
  if (!a || !b) return Math.max(a.length, b.length);

  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);

  for (let j = 1; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }

  return dp[a.length][b.length];
}

function areSimilar(a, b) {
  const x = normalizeAnswer(a);
  const y = normalizeAnswer(b);

  if (!x || !y) return false;
  if (x === y) return true;

  // typo tolerance
  if (editDistance(x, y) <= 1) return true;

  // word overlap match
  const xWords = new Set(x.split(' '));
  const yWords = new Set(y.split(' '));

  const overlap = [...xWords].filter(w => yWords.has(w)).length;
  const smaller = Math.min(xWords.size, yWords.size);

  return smaller > 0 && overlap / smaller >= 0.75;
}

export function groupAnswers(players, answers, excludeRoles = []) {
  const groups = [];

  Object.entries(answers || {}).forEach(([playerId, obj]) => {
    const player = players?.[playerId];
    if (!player || excludeRoles.includes(player.role)) return;

    const raw = (obj?.answer || '').trim() || '(no answer)';
    const normalized = normalizeAnswer(raw) || '__blank__';

    let group = groups.find(g => areSimilar(g.display, raw) || g.key === normalized);

    if (!group) {
      group = {
        key: normalized,
        display: raw,
        count: 0,
        playerIds: [],
        variants: []
      };
      groups.push(group);
    }

    group.count += 1;
    group.playerIds.push(playerId);
    group.variants.push(raw);

    // choose cleaner display version
    if (
      raw !== '(no answer)' &&
      (group.display === '(no answer)' || raw.length < group.display.length)
    ) {
      group.display = raw;
    }
  });

  return groups.sort((a, b) => b.count - a.count);
}

export function getHerdAnswer(groups) {
  return groups?.[0] || null;
}

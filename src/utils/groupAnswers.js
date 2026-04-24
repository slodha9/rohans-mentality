// Basic normalization + fuzzy grouping

export function normalizeAnswer(ans) {
  if (!ans) return "";

  return ans
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "") // remove punctuation
    .replace(/\s+/g, " ")    // normalize spaces
    .replace(/s$/, "");      // very basic plural handling (stocks -> stock)
}

// Levenshtein distance (simple similarity)
function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0)
  );

  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] =
          1 +
          Math.min(
            dp[i - 1][j],     // delete
            dp[i][j - 1],     // insert
            dp[i - 1][j - 1]  // replace
          );
      }
    }
  }

  return dp[a.length][b.length];
}

function isSimilar(a, b) {
  const dist = levenshtein(a, b);
  return dist <= 2; // tweak sensitivity here
}

export function groupAnswers(answers) {
  const groups = [];

  answers.forEach((ansObj) => {
    const normalized = normalizeAnswer(ansObj.answer);

    let found = false;

    for (let group of groups) {
      if (isSimilar(group.key, normalized)) {
        group.answers.push(ansObj);
        found = true;
        break;
      }
    }

    if (!found) {
      groups.push({
        key: normalized,
        answers: [ansObj],
      });
    }
  });

  return groups;
}

export function getHerdAnswer(groups) {
  let maxGroup = groups[0];

  groups.forEach((g) => {
    if (g.answers.length > maxGroup.answers.length) {
      maxGroup = g;
    }
  });

  return maxGroup;
}

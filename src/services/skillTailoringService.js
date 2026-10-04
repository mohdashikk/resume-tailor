function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/react\.js\b/g, 'react')
    .replace(/node\.js\b/g, 'node')
    .replace(/html5\b/g, 'html')
    .replace(/css3\b/g, 'css')
    .replace(/[^a-z0-9+#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function skillScore(skill, jobDescription) {
  const term = normalize(skill);
  const description = normalize(jobDescription);
  if (!term || !description) return 0;
  if (` ${description} `.includes(` ${term} `)) return 100 + term.length;

  const tokens = term.split(' ').filter((token) => token.length > 1);
  if (!tokens.length) return 0;
  const descriptionTokens = new Set(description.split(' '));
  const matches = tokens.filter((token) => descriptionTokens.has(token)).length;
  return matches === tokens.length ? 60 + matches : (matches / tokens.length) * 20;
}

export function prioritizeSkillsForJob(skillGroups, jobDescription) {
  return (skillGroups || [])
    .map((group, groupIndex) => {
      const rankedSkills = (group.skills || [])
        .map((skill, skillIndex) => ({ skill, skillIndex, score: skillScore(skill, jobDescription) }))
        .sort((left, right) => right.score - left.score || left.skillIndex - right.skillIndex);
      return {
        group: { ...group, skills: rankedSkills.map(({ skill }) => skill) },
        groupIndex,
        score: rankedSkills.reduce((total, item) => total + item.score, 0),
        bestScore: rankedSkills[0]?.score || 0,
      };
    })
    .sort((left, right) => right.bestScore - left.bestScore || right.score - left.score || left.groupIndex - right.groupIndex)
    .map(({ group }) => group);
}

export function didSkillOrderChange(before, after) {
  const order = (groups) => (groups || []).map((group) => `${group.id}:${(group.skills || []).join('|')}`).join('||');
  return order(before) !== order(after);
}

// Dota 2 Strategy Analyzer & Suggestion Engine

export function getHeroWinRate(hero) {
  // Use pro games if sufficient sample, else pub 5_win/5_pick (Archon/Legend) or 50%
  if (hero.pro_pick && hero.pro_pick >= 15) {
    return (hero.pro_win / hero.pro_pick) * 100;
  }
  if (hero["5_pick"] && hero["5_pick"] > 0) {
    return (hero["5_win"] / hero["5_pick"]) * 100;
  }
  if (hero.turbo_picks && hero.turbo_picks > 0) {
    return (hero.turbo_wins / hero.turbo_picks) * 100;
  }
  return 50.0;
}

export function evaluateTeam(heroes) {
  const rolesCount = {};
  const attrs = { str: 0, agi: 0, int: 0, all: 0 };
  let meleeCount = 0;
  let rangedCount = 0;

  heroes.forEach(h => {
    (h.roles || []).forEach(role => {
      rolesCount[role] = (rolesCount[role] || 0) + 1;
    });
    if (attrs[h.primary_attr] !== undefined) {
      attrs[h.primary_attr]++;
    }
    if (h.attack_type === "Melee") meleeCount++;
    else if (h.attack_type === "Ranged") rangedCount++;
  });

  const disables = rolesCount["Disabler"] || 0;
  const initiation = rolesCount["Initiator"] || 0;
  const carries = rolesCount["Carry"] || 0;
  const supports = rolesCount["Support"] || 0;
  const durable = rolesCount["Durable"] || 0;
  const pushers = rolesCount["Pusher"] || 0;
  const nukers = rolesCount["Nuker"] || 0;

  const warnings = [];
  const strengths = [];

  if (heroes.length >= 2) {
    if (disables === 0) warnings.push("Lack of reliable crowd control / disables.");
    else if (disables >= 2) strengths.push("Strong lockdown and disable chain.");

    if (initiation === 0) warnings.push("No natural initiator to start fights.");
    else strengths.push("Reliable teamfight initiation.");

    if (durable === 0 && heroes.length >= 3) warnings.push("Squishy lineup without a frontline tank.");
    if (carries === 0 && heroes.length >= 3) warnings.push("Lacks dedicated late-game carry scaling.");
    else if (carries > 3) warnings.push("Greedy lineup with too many farm-dependent cores.");

    if (pushers === 0 && heroes.length >= 4) warnings.push("Low tower pressure / objective sieging.");
    if (meleeCount >= 4) warnings.push("Heavy melee draft susceptible to kiting / AOE.");
  }

  return {
    count: heroes.length,
    rolesCount,
    attrs,
    disables,
    initiation,
    carries,
    supports,
    durable,
    pushers,
    nukers,
    meleeCount,
    rangedCount,
    warnings,
    strengths
  };
}

export function calculateDraftAdvantage(radiantPicks, direPicks) {
  if (!radiantPicks.length && !direPicks.length) {
    return { radiantPct: 50, direPct: 50, diffText: "Even Matchup" };
  }

  const radEval = evaluateTeam(radiantPicks);
  const direEval = evaluateTeam(direPicks);

  let radScore = 50;
  let direScore = 50;

  // Base hero winrates
  if (radiantPicks.length) {
    const avgRadWr = radiantPicks.reduce((acc, h) => acc + getHeroWinRate(h), 0) / radiantPicks.length;
    radScore += (avgRadWr - 50) * 0.8;
  }
  if (direPicks.length) {
    const avgDireWr = direPicks.reduce((acc, h) => acc + getHeroWinRate(h), 0) / direPicks.length;
    direScore += (avgDireWr - 50) * 0.8;
  }

  // Synergy bonuses
  if (radEval.disables > 0) radScore += 2;
  if (radEval.initiation > 0) radScore += 2;
  if (radEval.carries >= 1 && radEval.carries <= 2) radScore += 2;
  if (radEval.supports >= 1) radScore += 2;

  if (direEval.disables > 0) direScore += 2;
  if (direEval.initiation > 0) direScore += 2;
  if (direEval.carries >= 1 && direEval.carries <= 2) direScore += 2;
  if (direEval.supports >= 1) direScore += 2;

  // Normalization
  const total = radScore + direScore;
  const radiantPct = Math.round((radScore / total) * 100);
  const direPct = 100 - radiantPct;

  let diffText = "Even Matchup";
  if (radiantPct > direPct + 6) diffText = "Radiant Advantage";
  else if (direPct > radiantPct + 6) diffText = "Dire Advantage";

  return { radiantPct, direPct, diffText, radEval, direEval };
}

export function generateHeroSuggestions(availableHeroes, teamHeroes, enemyHeroes, actionType = "pick") {
  if (!availableHeroes || !availableHeroes.length) return [];

  const teamEval = evaluateTeam(teamHeroes);
  const enemyEval = evaluateTeam(enemyHeroes);

  const scored = availableHeroes.map(hero => {
    let score = getHeroWinRate(hero);
    const reasons = [];

    const roles = hero.roles || [];
    const isDisabler = roles.includes("Disabler");
    const isInitiator = roles.includes("Initiator");
    const isCarry = roles.includes("Carry");
    const isSupport = roles.includes("Support");
    const isDurable = roles.includes("Durable");
    const isPusher = roles.includes("Pusher");

    // Need disables?
    if (teamEval.disables === 0 && isDisabler) {
      score += 6;
      reasons.push("Provides missing disable / CC");
    }

    // Need initiator?
    if (teamEval.initiation === 0 && isInitiator) {
      score += 5;
      reasons.push("Key fight initiator");
    }

    // Need frontline?
    if (teamEval.durable === 0 && isDurable) {
      score += 4;
      reasons.push("Solid frontline / durable");
    }

    // Need core/carry or support balance?
    if (teamEval.carries === 0 && isCarry) {
      score += 5;
      reasons.push("Primary core scaling");
    } else if (teamEval.carries >= 2 && isSupport) {
      score += 5;
      reasons.push("Supports greedy lineup");
    }

    // Counters to enemy attributes or roles
    if (enemyEval.count > 0) {
      // Enemy has high escape/elusive heroes?
      const enemyHasEscape = enemyHeroes.some(h => (h.roles || []).includes("Escape"));
      if (enemyHasEscape && (isDisabler || hero.localized_name === "Silencer" || hero.localized_name === "Doom" || hero.localized_name === "Lion")) {
        score += 5;
        reasons.push("Counters elusive enemies");
      }

      // Enemy has heavy melee?
      if (enemyEval.meleeCount >= 3 && hero.attack_type === "Ranged" && (roles.includes("Nuker") || isDisabler)) {
        score += 4;
        reasons.push("Kites melee-heavy enemy");
      }
    }

    if (reasons.length === 0) {
      if (score > 53) reasons.push("High winrate hero");
      else reasons.push("Flexible role fit");
    }

    return {
      hero,
      score,
      reasons: reasons.slice(0, 2)
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 4);
}

export function analyzeComposition(radiant, dire) {
  const radEval = evaluateTeam(radiant);
  const direEval = evaluateTeam(dire);

  const formatTeamBlock = (name, evalData, badgeClass) => {
    const rolesList = Object.entries(evalData.rolesCount)
      .map(([r, c]) => `<span class="badge ${badgeClass} me-1 mb-1">${r} (${c})</span>`)
      .join("") || `<span class="text-secondary small">No picks yet</span>`;

    const warningsList = evalData.warnings.length
      ? evalData.warnings.map(w => `<div class="warning-item"><i class="bi bi-exclamation-triangle-fill text-warning me-1"></i>${w}</div>`).join("")
      : (evalData.count >= 2 ? `<div class="text-success small"><i class="bi bi-check-circle-fill me-1"></i>Good role balance</div>` : "");

    return `
      <div class="team-analysis-block mb-3">
        <div class="d-flex justify-content-between align-items-center mb-1">
          <strong class="${name === 'Radiant' ? 'text-radiant' : 'text-dire'}">${name.toUpperCase()}</strong>
          <span class="small text-secondary">${evalData.count} / 5 heroes</span>
        </div>
        <div class="mb-2">${rolesList}</div>
        ${warningsList}
      </div>
    `;
  };

  return formatTeamBlock("Radiant", radEval, "bg-success-subtle text-success-emphasis") +
         formatTeamBlock("Dire", direEval, "bg-danger-subtle text-danger-emphasis");
}

export function buildCounterSummary(radiant, dire) {
  const advantage = calculateDraftAdvantage(radiant, dire);
  return `
    <div class="advantage-metric mb-2">
      <div class="d-flex justify-content-between small mb-1">
        <span class="text-radiant fw-bold">Radiant ${advantage.radiantPct}%</span>
        <span class="text-secondary fw-semibold">${advantage.diffText}</span>
        <span class="text-dire fw-bold">Dire ${advantage.direPct}%</span>
      </div>
      <div class="progress" style="height: 8px;">
        <div class="progress-bar bg-radiant" style="width: ${advantage.radiantPct}%"></div>
        <div class="progress-bar bg-dire" style="width: ${advantage.direPct}%"></div>
      </div>
    </div>
  `;
}

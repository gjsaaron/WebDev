import { state, snapshotDraft, restoreDraft } from "./state.js";

export const CAPTAINS_MODE_SEQUENCE = [
  // phase 1 bans
  { team: "radiant", type: "ban", phase: 1, label: "Radiant Ban 1" },
  { team: "dire",    type: "ban", phase: 1, label: "Dire Ban 1" },
  { team: "radiant", type: "ban", phase: 1, label: "Radiant Ban 2" },
  { team: "dire",    type: "ban", phase: 1, label: "Dire Ban 2" },
  { team: "radiant", type: "ban", phase: 1, label: "Radiant Ban 3" },
  { team: "dire",    type: "ban", phase: 1, label: "Dire Ban 3" },
  { team: "radiant", type: "ban", phase: 1, label: "Radiant Ban 4" },
  { team: "dire",    type: "ban", phase: 1, label: "Dire Ban 4" },

  // phase 1 picks
  { team: "radiant", type: "pick", phase: 1, label: "Radiant Pick 1" },
  { team: "dire",    type: "pick", phase: 1, label: "Dire Pick 1" },
  { team: "dire",    type: "pick", phase: 1, label: "Dire Pick 2" },
  { team: "radiant", type: "pick", phase: 1, label: "Radiant Pick 2" },

  // phase 2 bans
  { team: "radiant", type: "ban", phase: 2, label: "Radiant Ban 5" },
  { team: "dire",    type: "ban", phase: 2, label: "Dire Ban 5" },
  { team: "radiant", type: "ban", phase: 2, label: "Radiant Ban 6" },
  { team: "dire",    type: "ban", phase: 2, label: "Dire Ban 6" },

  // phase 2 picks
  { team: "radiant", type: "pick", phase: 2, label: "Radiant Pick 3" },
  { team: "dire",    type: "pick", phase: 2, label: "Dire Pick 3" },
  { team: "radiant", type: "pick", phase: 2, label: "Radiant Pick 4" },
  { team: "dire",    type: "pick", phase: 2, label: "Dire Pick 4" },

  // phase 3 bans
  { team: "radiant", type: "ban", phase: 3, label: "Radiant Ban 7" },
  { team: "dire",    type: "ban", phase: 3, label: "Dire Ban 7" },

  // phase 3 picks
  { team: "dire",    type: "pick", phase: 3, label: "Dire Pick 5" },
  { team: "radiant", type: "pick", phase: 3, label: "Radiant Pick 5" }
];

export function getCurrentCMStep() {
  if (state.mode !== "captains") return null;
  return CAPTAINS_MODE_SEQUENCE[state.cmTurn] || null;
}

export function selectHero(hero) {
  const alreadyUsed = [
    ...state.radiant,
    ...state.dire,
    ...state.radiantBans,
    ...state.direBans
  ].some(item => item.id === hero.id);

  if (alreadyUsed) {
    return { ok: false, message: `${hero.localized_name} has already been picked or banned.` };
  }

  let team = state.activeTeam;
  let action = state.actionType;

  if (state.mode === "captains") {
    const step = getCurrentCMStep();
    if (step) {
      team = step.team;
      action = step.type;
      state.activeTeam = team;
      state.actionType = action;
    } else {
      return { ok: false, message: "Captain's Mode draft is complete (all 24 turns finished)." };
    }
  }

  if (action === "pick") {
    if (state[team].length >= 5) {
      return { ok: false, message: `${team.toUpperCase()} already has 5 picks.` };
    }
  } else {
    const banList = team === "radiant" ? state.radiantBans : state.direBans;
    if (banList.length >= 7) {
      return { ok: false, message: `${team.toUpperCase()} already has 7 bans.` };
    }
  }

  state.history.push(snapshotDraft());

  if (action === "pick") {
    state[team].push(hero);
  } else {
    const banObj = { ...hero, team };
    if (team === "radiant") {
      state.radiantBans.push(banObj);
    } else {
      state.direBans.push(banObj);
    }
    state.bans.push(banObj);
  }

  // next turn
  if (state.mode === "captains") {
    state.cmTurn++;
    if (state.cmTurn < CAPTAINS_MODE_SEQUENCE.length) {
      const nextStep = CAPTAINS_MODE_SEQUENCE[state.cmTurn];
      state.activeTeam = nextStep.team;
      state.actionType = nextStep.type;
    }
  }

  return {
    ok: true,
    message: `${hero.localized_name} ${action === "pick" ? "picked" : "banned"} for ${team.toUpperCase()}.`
  };
}

export function removeDraftHero(team, type, index) {
  state.history.push(snapshotDraft());
  if (type === "pick") {
    state[team].splice(index, 1);
  } else {
    const list = team === "radiant" ? state.radiantBans : state.direBans;
    const removed = list.splice(index, 1)[0];
    if (removed) {
      state.bans = state.bans.filter(b => b.id !== removed.id);
    }
  }
  // sync cm turn index
  if (state.mode === "captains") {
    syncCMTurn();
  }
  return true;
}

export function syncCMTurn() {
  const totalActions = state.radiant.length + state.dire.length + state.radiantBans.length + state.direBans.length;
  state.cmTurn = Math.min(totalActions, CAPTAINS_MODE_SEQUENCE.length - 1);
  if (state.cmTurn < CAPTAINS_MODE_SEQUENCE.length) {
    state.activeTeam = CAPTAINS_MODE_SEQUENCE[state.cmTurn].team;
    state.actionType = CAPTAINS_MODE_SEQUENCE[state.cmTurn].type;
  }
}

export function undoDraft() {
  const previous = state.history.pop();
  if (!previous) return false;
  restoreDraft(previous);
  return true;
}

export function resetDraft() {
  state.radiant = [];
  state.dire = [];
  state.radiantBans = [];
  state.direBans = [];
  state.bans = [];
  state.history = [];
  state.cmTurn = 0;
  if (state.mode === "captains") {
    state.activeTeam = CAPTAINS_MODE_SEQUENCE[0].team;
    state.actionType = CAPTAINS_MODE_SEQUENCE[0].type;
  } else {
    state.activeTeam = "radiant";
    state.actionType = "pick";
  }
}

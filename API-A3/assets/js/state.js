export const state = {
  heroes: [],
  filteredHeroes: [],
  heroAbilitiesMap: {},
  mode: "captains", // "captains" or "custom"
  activeTeam: "radiant", // "radiant" or "dire"
  actionType: "ban", // starting action in Captain's Mode is ban
  cmTurn: 0,
  radiant: [], // Radiant picks (up to 5)
  dire: [], // Dire picks (up to 5)
  radiantBans: [], // Radiant bans (up to 7)
  direBans: [], // Dire bans (up to 7)
  bans: [], // combined bans for backwards compatibility
  history: [],
  savedDrafts: []
};

export function snapshotDraft() {
  return {
    radiant: [...state.radiant],
    dire: [...state.dire],
    radiantBans: [...state.radiantBans],
    direBans: [...state.direBans],
    bans: [...state.bans],
    activeTeam: state.activeTeam,
    actionType: state.actionType,
    cmTurn: state.cmTurn,
    mode: state.mode
  };
}

export function restoreDraft(snapshot) {
  state.radiant = [...snapshot.radiant];
  state.dire = [...snapshot.dire];
  state.radiantBans = [...(snapshot.radiantBans || snapshot.bans.filter(b => b.team === "radiant"))];
  state.direBans = [...(snapshot.direBans || snapshot.bans.filter(b => b.team === "dire"))];
  state.bans = [...snapshot.bans];
  state.activeTeam = snapshot.activeTeam;
  state.actionType = snapshot.actionType;
  state.cmTurn = snapshot.cmTurn ?? 0;
  if (snapshot.mode) state.mode = snapshot.mode;
}

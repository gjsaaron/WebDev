const DRAFTS_KEY = "draftArena:savedDrafts";

export function loadSavedDrafts() {
  try {
    const drafts = JSON.parse(localStorage.getItem(DRAFTS_KEY));
    return Array.isArray(drafts) ? drafts : [];
  } catch {
    return [];
  }
}

export function saveDraftRecord(draft) {
  const drafts = loadSavedDrafts();
  drafts.unshift(draft);
  const trimmed = drafts.slice(0, 30);
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(trimmed));
  return trimmed;
}

export function deleteDraftRecord(id) {
  let drafts = loadSavedDrafts();
  drafts = drafts.filter(d => d.id !== id);
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  return drafts;
}

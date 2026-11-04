import { fetchHeroStats, fetchHeroAbilitiesMap } from "./api/opendota.js";
import { state } from "./state.js";
import {
  selectHero,
  undoDraft,
  resetDraft,
  removeDraftHero,
  getCurrentCMStep,
  CAPTAINS_MODE_SEQUENCE
} from "./draft.js";
import {
  loadSavedDrafts,
  saveDraftRecord,
  deleteDraftRecord
} from "./storage.js";
import {
  calculateDraftAdvantage,
  generateHeroSuggestions,
  evaluateTeam,
  getHeroWinRate
} from "./analyzer.js";

const $ = id => document.getElementById(id);
const heroGrid = $("heroGrid");
const toastEl = $("appToast");
const toast = bootstrap.Toast.getOrCreateInstance(toastEl);

// Tooltip DOM Elements
const tooltipEl = $("heroSkillTooltip");
const tooltipImg = $("tooltipHeroImg");
const tooltipName = $("tooltipHeroName");
const tooltipAttr = $("tooltipAttrBadge");
const tooltipRoles = $("tooltipHeroRoles");
const tooltipSkillsList = $("tooltipSkillsList");

let currentAttrFilter = "all";

function notify(message) {
  $("toastMessage").textContent = message;
  toast.show();
}

function heroPortrait(hero) {
  const shortName = hero.name.replace("npc_dota_hero_", "");
  return `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${shortName}.png`;
}

function showHeroTooltip(hero, event) {
  if (!hero || !tooltipEl) return;

  tooltipImg.src = heroPortrait(hero);
  tooltipName.textContent = hero.localized_name.toUpperCase();

  const attrMap = {
    str: { label: "STR", class: "bg-danger" },
    agi: { label: "AGI", class: "bg-success" },
    int: { label: "INT", class: "bg-info text-dark" },
    all: { label: "UNI", class: "bg-warning text-dark" }
  };
  const attrInfo = attrMap[hero.primary_attr] || { label: (hero.primary_attr || "").toUpperCase(), class: "bg-secondary" };
  tooltipAttr.textContent = attrInfo.label;
  tooltipAttr.className = `badge ${attrInfo.class}`;

  const roles = (hero.roles || []).join(" · ");
  tooltipRoles.textContent = `${hero.attack_type || ""} · ${roles}`;

  const abilities = (state.heroAbilitiesMap && state.heroAbilitiesMap[hero.name]) || [];
  if (!abilities.length) {
    tooltipSkillsList.innerHTML = `<div class="text-secondary small p-2">Skill details loading or unavailable.</div>`;
  } else {
    tooltipSkillsList.innerHTML = abilities.map(ability => {
      let dmgBadge = "";
      if (ability.dmg) {
        const dmgLower = ability.dmg.toLowerCase();
        const dmgClass = dmgLower === "physical" ? "dmg-physical" : (dmgLower === "magical" ? "dmg-magical" : "dmg-pure");
        dmgBadge = `<span class="skill-tag ${dmgClass}">${ability.dmg}</span>`;
      }
      const behaviorBadge = ability.behavior ? `<span class="skill-tag behavior-tag">${ability.behavior}</span>` : "";
      const mcBadge = ability.mc ? `<span class="skill-tag mc-tag">💧 ${ability.mc}</span>` : "";
      const cdBadge = ability.cd ? `<span class="skill-tag cd-tag">⏱ ${ability.cd}s</span>` : "";

      return `
        <div class="tooltip-skill-item">
          <img class="tooltip-skill-icon" src="${ability.img}" alt="${ability.name}" onerror="this.style.display='none'">
          <div class="tooltip-skill-details">
            <div class="tooltip-skill-title-row">
              <span class="tooltip-skill-name">${ability.name}</span>
            </div>
            <div class="tooltip-skill-badges">
              ${dmgBadge}
              ${behaviorBadge}
              ${mcBadge}
              ${cdBadge}
            </div>
            <p class="tooltip-skill-desc">${ability.desc || "No description available."}</p>
          </div>
        </div>
      `;
    }).join("");
  }

  tooltipEl.classList.remove("d-none");
  tooltipEl.classList.add("visible");
  updateTooltipPosition(event);
}

function updateTooltipPosition(event) {
  if (!tooltipEl || tooltipEl.classList.contains("d-none")) return;
  const padding = 14;
  const tooltipWidth = tooltipEl.offsetWidth || 350;
  const tooltipHeight = tooltipEl.offsetHeight || 300;

  let left = event.clientX + 16;
  let top = event.clientY + 12;

  // Flip horizontally if overflow right
  if (left + tooltipWidth > window.innerWidth - padding) {
    left = event.clientX - tooltipWidth - 14;
  }
  if (left < padding) left = padding;

  // Flip vertically if overflow bottom
  if (top + tooltipHeight > window.innerHeight - padding) {
    top = window.innerHeight - tooltipHeight - padding;
  }
  if (top < padding) top = padding;

  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
}

function hideHeroTooltip() {
  if (!tooltipEl) return;
  tooltipEl.classList.remove("visible");
  tooltipEl.classList.add("d-none");
}

function getUsedHeroIds() {
  return new Set([
    ...state.radiant.map(h => ({ id: h.id, type: "PICK", team: "radiant" })),
    ...state.dire.map(h => ({ id: h.id, type: "PICK", team: "dire" })),
    ...state.radiantBans.map(h => ({ id: h.id, type: "BAN", team: "radiant" })),
    ...state.direBans.map(h => ({ id: h.id, type: "BAN", team: "dire" }))
  ]);
}

function getUsedHeroMap() {
  const map = new Map();
  state.radiant.forEach(h => map.set(h.id, { type: "PICK", team: "radiant" }));
  state.dire.forEach(h => map.set(h.id, { type: "PICK", team: "dire" }));
  state.radiantBans.forEach(h => map.set(h.id, { type: "BAN", team: "radiant" }));
  state.direBans.forEach(h => map.set(h.id, { type: "BAN", team: "dire" }));
  return map;
}

// -------------------------------------------------------------
// HEROES GALLERY RENDERING
// -------------------------------------------------------------
function renderHeroes() {
  if (!state.heroes || !state.heroes.length) return;

  const query = $("heroSearch").value.trim().toLowerCase();
  const attr = currentAttrFilter;
  const role = $("roleFilter").value.toLowerCase();
  const usedMap = getUsedHeroMap();

  $("clearSearchBtn").classList.toggle("d-none", query.length === 0);

  const filtered = state.heroes.filter(hero => {
    const matchesName = hero.localized_name.toLowerCase().includes(query);
    let matchesAttr = true;
    if (attr !== "all") {
      if (attr === "all-attr") {
        matchesAttr = hero.primary_attr === "all";
      } else {
        matchesAttr = hero.primary_attr === attr;
      }
    }
    const matchesRole = role === "all" || (hero.roles || []).some(r => r.toLowerCase() === role);
    return matchesName && matchesAttr && matchesRole;
  });

  $("heroCount").textContent = `${filtered.length} of ${state.heroes.length} heroes`;

  if (!filtered.length) {
    heroGrid.innerHTML = `<div class="text-secondary p-3 text-center w-100">No heroes match the current filters.</div>`;
    return;
  }

  heroGrid.innerHTML = filtered.map(hero => {
    const usage = usedMap.get(hero.id);
    const isUsed = Boolean(usage);
    const badgeText = usage ? `${usage.type}` : "";

    return `
      <div class="card hero-card-tile ${isUsed ? "used-hero" : ""}"
           data-hero-id="${hero.id}">
        <div class="hero-img-wrap">
          <img class="card-img-top"
               src="${heroPortrait(hero)}"
               alt="${hero.localized_name}"
               loading="lazy"
               onerror="this.src='https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${hero.name.replace("npc_dota_hero_", "")}.png'">
          <span class="attr-badge ${hero.primary_attr}"></span>
          ${isUsed ? `<span class="used-badge">${badgeText}</span>` : ""}
        </div>
        <div class="card-footer p-1 hero-name-label">${hero.localized_name}</div>
      </div>
    `;
  }).join("");

  heroGrid.querySelectorAll(".hero-card-tile").forEach(tile => {
    const heroId = Number(tile.dataset.heroId);
    const hero = state.heroes.find(h => h.id === heroId);

    tile.addEventListener("mouseenter", (e) => {
      if (hero) showHeroTooltip(hero, e);
    });
    tile.addEventListener("mousemove", (e) => updateTooltipPosition(e));
    tile.addEventListener("mouseleave", hideHeroTooltip);

    if (!tile.classList.contains("used-hero")) {
      tile.addEventListener("click", () => {
        hideHeroTooltip();
        if (!hero) return;
        handleHeroSelection(hero);
      });
    }
  });
}

function handleHeroSelection(hero) {
  const result = selectHero(hero);
  notify(result.message);
  if (result.ok) {
    renderAll();
  }
}

// -------------------------------------------------------------
// BOTTOM SLOTS RENDERING (Bans & Picks)
// -------------------------------------------------------------
function renderSlots() {
  const isRadiantTurn = state.activeTeam === "radiant";
  const isDireTurn = state.activeTeam === "dire";
  const isBanAction = state.actionType === "ban";
  const isPickAction = state.actionType === "pick";

  // 1. Radiant Bans (7 slots)
  const radBanContainer = $("radiantBanSlots");
  radBanContainer.innerHTML = Array.from({ length: 7 }, (_, i) => {
    const hero = state.radiantBans[i];
    const isNext = isRadiantTurn && isBanAction && i === state.radiantBans.length;
    if (hero) {
      return `
        <div class="card ban-slot filled" data-hero-id="${hero.id}">
          <img src="${heroPortrait(hero)}" alt="${hero.localized_name}">
          <div class="ban-slash-overlay"></div>
          <button class="btn-slot-remove" data-action="remove" data-team="radiant" data-type="ban" data-index="${i}" title="Remove ban">×</button>
        </div>
      `;
    }
    return `
      <div class="card ban-slot ${isNext ? 'active-turn-slot radiant' : ''}" data-target-slot="radiant-ban-${i}" title="Radiant Ban Slot ${i + 1}">
        <span class="slot-num">${i + 1}</span>
      </div>
    `;
  }).join("");

  // 2. Dire Bans (7 slots)
  const direBanContainer = $("direBanSlots");
  direBanContainer.innerHTML = Array.from({ length: 7 }, (_, i) => {
    const hero = state.direBans[i];
    const isNext = isDireTurn && isBanAction && i === state.direBans.length;
    if (hero) {
      return `
        <div class="card ban-slot filled" data-hero-id="${hero.id}">
          <img src="${heroPortrait(hero)}" alt="${hero.localized_name}">
          <div class="ban-slash-overlay"></div>
          <button class="btn-slot-remove" data-action="remove" data-team="dire" data-type="ban" data-index="${i}" title="Remove ban">×</button>
        </div>
      `;
    }
    return `
      <div class="card ban-slot ${isNext ? 'active-turn-slot dire' : ''}" data-target-slot="dire-ban-${i}" title="Dire Ban Slot ${i + 1}">
        <span class="slot-num">${i + 1}</span>
      </div>
    `;
  }).join("");

  // 3. Radiant Picks (5 slots)
  const radPickContainer = $("radiantPickSlots");
  radPickContainer.innerHTML = Array.from({ length: 5 }, (_, i) => {
    const hero = state.radiant[i];
    const isNext = isRadiantTurn && isPickAction && i === state.radiant.length;
    if (hero) {
      const roleText = (hero.roles || []).slice(0, 2).join(" · ");
      return `
        <div class="card pick-slot filled" data-hero-id="${hero.id}">
          <img class="card-img-top pick-hero-img" src="${heroPortrait(hero)}" alt="${hero.localized_name}">
          <span class="pick-attr-badge ${hero.primary_attr}"></span>
          <div class="card-footer p-1 pick-hero-footer">
            <span class="card-title pick-hero-name mb-0">${hero.localized_name}</span>
            <span class="card-subtitle text-muted pick-hero-role">${roleText}</span>
          </div>
          <button class="btn-slot-remove" data-action="remove" data-team="radiant" data-type="pick" data-index="${i}" title="Remove pick">×</button>
        </div>
      `;
    }
    return `
      <div class="card pick-slot ${isNext ? 'active-turn-slot radiant' : ''}" data-target-slot="radiant-pick-${i}" title="Radiant Pick Slot ${i + 1}">
        <div class="empty-pick-content">
          <span class="empty-pick-num">${i + 1}</span>
          <span class="empty-pick-label">PICK</span>
        </div>
      </div>
    `;
  }).join("");

  // 4. Dire Picks (5 slots)
  const direPickContainer = $("direPickSlots");
  direPickContainer.innerHTML = Array.from({ length: 5 }, (_, i) => {
    const hero = state.dire[i];
    const isNext = isDireTurn && isPickAction && i === state.dire.length;
    if (hero) {
      const roleText = (hero.roles || []).slice(0, 2).join(" · ");
      return `
        <div class="card pick-slot filled" data-hero-id="${hero.id}">
          <img class="card-img-top pick-hero-img" src="${heroPortrait(hero)}" alt="${hero.localized_name}">
          <span class="pick-attr-badge ${hero.primary_attr}"></span>
          <div class="card-footer p-1 pick-hero-footer">
            <span class="card-title pick-hero-name mb-0">${hero.localized_name}</span>
            <span class="card-subtitle text-muted pick-hero-role">${roleText}</span>
          </div>
          <button class="btn-slot-remove" data-action="remove" data-team="dire" data-type="pick" data-index="${i}" title="Remove pick">×</button>
        </div>
      `;
    }
    return `
      <div class="card pick-slot ${isNext ? 'active-turn-slot dire' : ''}" data-target-slot="dire-pick-${i}" title="Dire Pick Slot ${i + 1}">
        <div class="empty-pick-content">
          <span class="empty-pick-num">${i + 1}</span>
          <span class="empty-pick-label">PICK</span>
        </div>
      </div>
    `;
  }).join("");

  // Bind Remove buttons
  document.querySelectorAll("[data-action='remove']").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const team = btn.dataset.team;
      const type = btn.dataset.type;
      const index = Number(btn.dataset.index);
      removeDraftHero(team, type, index);
      renderAll();
      notify(`Removed ${team} ${type} slot ${index + 1}.`);
    });
  });

  // Bind Empty Slot Click -> quick select turn
  document.querySelectorAll("[data-target-slot]").forEach(slot => {
    slot.addEventListener("click", () => {
      hideHeroTooltip();
      const [team, type] = slot.dataset.targetSlot.split("-");
      state.activeTeam = team;
      state.actionType = type;
      renderAll();
    });
  });

  // Tooltip for filled pick and ban slots
  document.querySelectorAll(".ban-slot.filled, .pick-slot.filled").forEach(slot => {
    const heroId = Number(slot.dataset.heroId);
    const hero = state.heroes.find(h => h.id === heroId);
    if (hero) {
      slot.addEventListener("mouseenter", (e) => showHeroTooltip(hero, e));
      slot.addEventListener("mousemove", (e) => updateTooltipPosition(e));
      slot.addEventListener("mouseleave", hideHeroTooltip);
    }
  });
}

// -------------------------------------------------------------
// DRAFT ANALYSIS & SUGGESTIONS RENDERING
// -------------------------------------------------------------
function renderAnalysis() {
  const advantage = calculateDraftAdvantage(state.radiant, state.dire);

  $("radiantAdvPct").textContent = `${advantage.radiantPct}%`;
  $("direAdvPct").textContent = `${advantage.direPct}%`;
  $("advantageLabel").textContent = advantage.diffText;
  $("radiantAdvBar").style.width = `${advantage.radiantPct}%`;
  $("direAdvBar").style.width = `${advantage.direPct}%`;

  // Suggestions for the active team
  const activeTeamName = state.activeTeam;
  const teamHeroes = activeTeamName === "radiant" ? state.radiant : state.dire;
  const enemyHeroes = activeTeamName === "radiant" ? state.dire : state.radiant;
  const usedIds = new Set([
    ...state.radiant.map(h => h.id),
    ...state.dire.map(h => h.id),
    ...state.radiantBans.map(h => h.id),
    ...state.direBans.map(h => h.id)
  ]);
  const availableHeroes = (state.heroes || []).filter(h => !usedIds.has(h.id));

  const tagEl = $("suggestionTeamTag");
  tagEl.textContent = `FOR ${activeTeamName.toUpperCase()}`;
  tagEl.className = `active-team-tag ${activeTeamName}`;

  const suggestions = generateHeroSuggestions(availableHeroes, teamHeroes, enemyHeroes, state.actionType);
  const sugContainer = $("suggestionsContainer");

  if (!suggestions.length) {
    sugContainer.innerHTML = `<div class="suggestion-placeholder">No suggestions available.</div>`;
  } else {
    sugContainer.innerHTML = suggestions.map(({ hero, reasons }) => {
      const actionVerb = state.actionType === "ban" ? "Ban" : "Pick";
      return `
        <div class="card suggestion-card" data-hero-id="${hero.id}">
          <div class="card-body p-2 d-flex align-items-center gap-2">
            <img class="suggestion-thumb rounded" src="${heroPortrait(hero)}" alt="${hero.localized_name}">
            <div class="suggestion-details flex-grow-1 min-w-0">
              <div class="card-title suggestion-hero-name mb-0">${hero.localized_name}</div>
              <div class="suggestion-reasons mt-1">
                ${reasons.map(r => `<span class="badge bg-secondary-subtle text-secondary-emphasis reason-tag">${r}</span>`).join("")}
              </div>
            </div>
            <button class="btn btn-sm btn-select-suggested" data-suggest-id="${hero.id}">
              ${actionVerb}
            </button>
          </div>
        </div>
      `;
    }).join("");

    sugContainer.querySelectorAll(".suggestion-card").forEach(card => {
      const heroId = Number(card.dataset.heroId);
      const hero = state.heroes.find(h => h.id === heroId);
      if (hero) {
        card.addEventListener("mouseenter", (e) => showHeroTooltip(hero, e));
        card.addEventListener("mousemove", (e) => updateTooltipPosition(e));
        card.addEventListener("mouseleave", hideHeroTooltip);
      }
    });

    sugContainer.querySelectorAll("[data-suggest-id]").forEach(btn => {
      btn.addEventListener("click", () => {
        hideHeroTooltip();
        const id = Number(btn.dataset.suggestId);
        const hero = state.heroes.find(h => h.id === id);
        if (hero) handleHeroSelection(hero);
      });
    });
  }

  // Composition breakdown
  const radEval = evaluateTeam(state.radiant);
  const direEval = evaluateTeam(state.dire);

  const formatTeamComp = (teamName, evalData, colorClass) => {
    const rolesPills = Object.entries(evalData.rolesCount).map(([r, c]) =>
      `<span class="badge bg-dark border border-secondary-subtle role-pill me-1 mb-1">${r} (${c})</span>`
    ).join("") || `<span class="text-secondary small">No picks yet</span>`;

    const warningsHtml = evalData.warnings.map(w =>
      `<div class="warning-item"><i class="bi bi-exclamation-triangle me-1"></i>${w}</div>`
    ).join("");

    const strengthsHtml = evalData.strengths.map(s =>
      `<div class="strength-item"><i class="bi bi-shield-check me-1"></i>${s}</div>`
    ).join("");

    return `
      <div class="card team-comp-card bg-transparent border-0 mb-2">
        <div class="card-header bg-transparent p-0 pb-1 border-0 d-flex justify-content-between align-items-center">
          <span class="${colorClass} fw-bold">${teamName.toUpperCase()} (${evalData.count}/5)</span>
          <span class="text-secondary small">Disables: ${evalData.disables} · Frontline: ${evalData.durable}</span>
        </div>
        <div class="card-body p-0">
          <div class="mb-1">${rolesPills}</div>
          ${strengthsHtml}
          ${warningsHtml}
        </div>
      </div>
    `;
  };

  $("compositionBreakdown").innerHTML =
    formatTeamComp("Radiant", radEval, "radiant-text") +
    `<hr class="border-secondary my-2">` +
    formatTeamComp("Dire", direEval, "dire-text");
}

// -------------------------------------------------------------
// HEADER & STATUS BAR UPDATE
// -------------------------------------------------------------
function renderHeaderStatus() {
  const activeBadge = $("activeTurnBadge");
  const draftPrompt = $("draftPrompt");
  const draftPhaseTag = $("draftPhaseTag");

  const team = state.activeTeam;
  const action = state.actionType;

  activeBadge.className = `turn-indicator-badge ${team}`;
  activeBadge.textContent = `${team.toUpperCase()} ${action.toUpperCase()}`;

  if (state.mode === "captains") {
    const step = getCurrentCMStep();
    if (step) {
      activeBadge.textContent = step.label.toUpperCase();
      draftPrompt.textContent = `Captain's Mode · Step ${state.cmTurn + 1} of ${CAPTAINS_MODE_SEQUENCE.length}`;
      draftPhaseTag.textContent = `Phase ${step.phase} ${step.type === 'ban' ? 'Bans' : 'Picks'}`;
    } else {
      activeBadge.textContent = "DRAFT COMPLETE";
      draftPrompt.textContent = "All 24 Captain's Mode turns finished.";
      draftPhaseTag.textContent = "Completed";
    }
  } else {
    draftPrompt.textContent = "Custom Free Draft · Select any hero to assign";
    draftPhaseTag.textContent = "Custom Mode";
  }

  // Active Team toggle buttons
  $("radiantTurnBtn").classList.toggle("active", team === "radiant");
  $("direTurnBtn").classList.toggle("active", team === "dire");

  // Ban toggle button
  const isBan = action === "ban";
  $("banToggleBtn").classList.toggle("ban-active", isBan);
  $("banToggleLabel").textContent = isBan ? "Ban Active" : "Pick Active";

  // Undo button
  $("undoBtn").disabled = state.history.length === 0;
}

// -------------------------------------------------------------
// SAVED DRAFTS
// -------------------------------------------------------------
function renderSavedDrafts() {
  state.savedDrafts = loadSavedDrafts();
  $("savedCount").textContent = state.savedDrafts.length;

  const container = $("savedDraftPreview");
  if (!state.savedDrafts.length) {
    container.innerHTML = "No saved drafts yet.";
    return;
  }

  container.innerHTML = state.savedDrafts.slice(0, 3).map(draft => `
    <div class="d-flex justify-content-between align-items-center mb-1">
      <span class="text-truncate me-2" title="${draft.name}">${draft.name}</span>
      <button class="btn btn-sm btn-link text-danger p-0 delete-draft-btn" data-draft-id="${draft.id}" title="Delete">
        <i class="bi bi-trash"></i>
      </button>
    </div>
  `).join("");

  container.querySelectorAll(".delete-draft-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.savedDrafts = deleteDraftRecord(btn.dataset.draftId);
      renderSavedDrafts();
      notify("Draft deleted.");
    });
  });
}

// -------------------------------------------------------------
// RENDER ALL
// -------------------------------------------------------------
function renderAll() {
  renderHeaderStatus();
  renderSlots();
  renderAnalysis();
  renderHeroes();
  renderSavedDrafts();
}

// -------------------------------------------------------------
// EVENT BINDINGS
// -------------------------------------------------------------
function bindEvents() {
  // Mode selection
  $("captainsMode").addEventListener("click", () => {
    state.mode = "captains";
    $("captainsMode").classList.add("active");
    $("customMode").classList.remove("active");
    const step = getCurrentCMStep();
    if (step) {
      state.activeTeam = step.team;
      state.actionType = step.type;
    }
    renderAll();
    notify("Switched to Captain's Mode.");
  });

  $("customMode").addEventListener("click", () => {
    state.mode = "custom";
    $("customMode").classList.add("active");
    $("captainsMode").classList.remove("active");
    renderAll();
    notify("Switched to Custom Draft.");
  });

  // Team quick toggles
  $("radiantTurnBtn").addEventListener("click", () => {
    state.activeTeam = "radiant";
    renderAll();
  });
  $("direTurnBtn").addEventListener("click", () => {
    state.activeTeam = "dire";
    renderAll();
  });

  // Pick/Ban quick toggle
  $("banToggleBtn").addEventListener("click", () => {
    state.actionType = state.actionType === "pick" ? "ban" : "pick";
    renderAll();
  });

  // Undo & Reset
  $("undoBtn").addEventListener("click", () => {
    if (undoDraft()) {
      renderAll();
      notify("Last draft action undone.");
    }
  });

  $("resetBtn").addEventListener("click", () => {
    if (!confirm("Reset current draft? All picks and bans will be cleared.")) return;
    resetDraft();
    renderAll();
    notify("Draft reset.");
  });

  // Search & Attribute Filter Buttons
  $("heroSearch").addEventListener("input", renderHeroes);
  $("clearSearchBtn").addEventListener("click", () => {
    $("heroSearch").value = "";
    renderHeroes();
  });

  $("roleFilter").addEventListener("change", renderHeroes);

  document.querySelectorAll(".attr-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".attr-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentAttrFilter = btn.dataset.attr;
      renderHeroes();
    });
  });

  // Save Draft
  $("saveDraftBtn").addEventListener("click", () => {
    if (!state.radiant.length && !state.dire.length && !state.radiantBans.length && !state.direBans.length) {
      notify("Select at least one hero before saving draft.");
      return;
    }
    const name = prompt("Name this draft:", `Draft ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    if (!name) return;

    state.savedDrafts = saveDraftRecord({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      name: name.trim(),
      createdAt: new Date().toISOString(),
      mode: state.mode,
      radiant: state.radiant.map(h => h.id),
      dire: state.dire.map(h => h.id),
      radiantBans: state.radiantBans.map(h => h.id),
      direBans: state.direBans.map(h => h.id)
    });
    renderSavedDrafts();
    notify("Draft saved successfully.");
  });

  // Compare Drafts Modal
  $("compareDraftsBtn").addEventListener("click", () => {
    const drafts = loadSavedDrafts();
    const modalBody = $("compareModalBody");
    if (drafts.length < 2) {
      modalBody.textContent = "Save at least two drafts to compare them.";
    } else {
      const heroMap = new Map((state.heroes || []).map(h => [h.id, h.localized_name]));
      modalBody.innerHTML = `
        <div class="table-responsive">
          <table class="table table-dark table-sm align-middle">
            <thead>
              <tr>
                <th>Draft Name</th>
                <th>Radiant Picks</th>
                <th>Dire Picks</th>
                <th>Bans</th>
              </tr>
            </thead>
            <tbody>
              ${drafts.slice(0, 6).map(d => `
                <tr>
                  <td class="fw-bold">${d.name}</td>
                  <td class="text-success">${(d.radiant || []).map(id => heroMap.get(id) || id).join(", ") || "—"}</td>
                  <td class="text-danger">${(d.dire || []).map(id => heroMap.get(id) || id).join(", ") || "—"}</td>
                  <td class="text-secondary small">
                    R: ${(d.radiantBans || []).map(id => heroMap.get(id) || id).join(", ") || "—"}<br>
                    D: ${(d.direBans || []).map(id => heroMap.get(id) || id).join(", ") || "—"}
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `;
    }
    bootstrap.Modal.getOrCreateInstance($("compareModal")).show();
  });
}

// -------------------------------------------------------------
// INITIALIZE
// -------------------------------------------------------------
async function initialize() {
  bindEvents();
  renderAll();

  try {
    const result = await fetchHeroStats();
    state.heroes = result.data.sort((a, b) => a.localized_name.localeCompare(b.localized_name));
    $("apiStatus").classList.add("online");
    $("apiStatus").innerHTML = `<span class="status-dot"></span><span>${result.cached ? "Cached Data" : "OpenDota Connected"}</span>`;
    $("heroError").classList.add("d-none");
    renderAll();
  } catch (error) {
    console.error("OpenDota error:", error);
    $("apiStatus").classList.add("offline");
    $("apiStatus").innerHTML = `<span class="status-dot"></span><span>API Offline</span>`;
    $("heroGrid").innerHTML = `<div class="text-secondary p-3 text-center w-100">Hero roster could not be loaded.</div>`;
    $("heroError").textContent = `Failed to load OpenDota hero data: ${error.message}.`;
    $("heroError").classList.remove("d-none");
    $("heroCount").textContent = "0 heroes";
  }

  // Fetch full hero abilities for hover tooltips
  try {
    const abilitiesResult = await fetchHeroAbilitiesMap();
    state.heroAbilitiesMap = abilitiesResult.data;
  } catch (error) {
    console.warn("Hero abilities metadata could not be fetched:", error);
  }
}

initialize();

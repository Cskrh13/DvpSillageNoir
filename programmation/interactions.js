/* ============================================================
   interactions.js — Sélection, ordres, capacités, IA
   ------------------------------------------------------------
   NOUVEAU :
   - Chaque unité a sa propre stratégie de ciblage (unit.targetStrategy).
   - Les unités en formation suivent la stratégie de l'unité avec le plus haut Cd à proximité.
   - 3 stratégies : CLOSEST (plus proche), LOWEST_HP (moins de PV), HIGHEST_CHANCE (meilleure chance).
   ============================================================ */
(function () {
  "use strict";

  // ---- Stratégies de ciblage ----
  const TARGET_STRATEGY = {
    CLOSEST: "closest",
    LOWEST_HP: "lowest_hp",
    HIGHEST_CHANCE: "highest_chance",
  };

  // ---- Capacités des héros ----
  const ABILITIES = {
    "maldris-dravelyth": [
      { key: "a", name: "Fouet des Lamentations", cd: 6000, range: 60, type: "debuff", desc: "Réduit la CC ennemie 4s." },
      { key: "z", name: "Charge impitoyable", cd: 9000, range: 120, type: "dash", desc: "Bond sur la cible, +1 F." },
      { key: "e", name: "Mépris des faibles", cd: 14000, range: 0, type: "aura", desc: "Aura de Peur 6s." },
    ],
    "moraveth-dravelyth": [
      { key: "a", name: "Sacrifice rituel", cd: 8000, range: 80, type: "ranged", desc: "Dégâts magiques, soigne Moraveth." },
      { key: "z", name: "Domaine de l'Agonie", cd: 12000, range: 100, type: "aoe", desc: "Zone de douleur, -1 I." },
      { key: "e", name: "Couvent du Sillage Noir", cd: 18000, range: 0, type: "buff", desc: "+1 Attaque aux alliés 5s." },
    ],
    "kharyx": [
      { key: "a", name: "Sauvagerie", cd: 5000, range: 50, type: "melee", desc: "Frappe en zone, premier." },
      { key: "z", name: "Aura sanguinaire", cd: 10000, range: 70, type: "aura", desc: "Frénésie 6s." },
      { key: "e", name: "Prédateur de la Lune", cd: 16000, range: 150, type: "dash", desc: "Saute sur la cible, Terreur." },
    ],
  };

  function abilitiesFor(heroId) { return ABILITIES[heroId] || []; }

  let selected = null;
  function select(unit) { if (selected) selected._selected = false; selected = unit || null; if (selected) selected._selected = true; }
  function getSelected() { return selected; }

  function orderMove(unit, types, grid, goal) {
    const path = Movement.findPath(types, grid, { col: unit.col, row: unit.row }, goal);
    if (path && path.length) { unit._path = path.slice(1); unit._order = "move"; }
  }
  function orderAttack(unit, target) { unit._path = []; unit._target = target; unit._order = "attack"; }
  function orderStop(unit) { unit._path = []; unit._order = "stop"; unit._target = null; }

  function castAbility(unit, idx) {
    const list = abilitiesFor(unit.id); const ab = list[idx];
    if (!ab) return false;
    const now = performance.now();
    if ((unit._cd?.[idx] || 0) > now) return false;
    unit._cd = unit._cd || {}; unit._cd[idx] = now + ab.cd; unit._lastCast = { idx, ability: ab, at: now };
    return true;
  }
  function isAbilityReady(unit, idx) {
    const list = abilitiesFor(unit.id); if (!list[idx]) return false;
    return (unit._cd?.[idx] || 0) <= performance.now();
  }

  // ========== NOUVELLES FONCTIONS ==========
  function getClosestTarget(unit, targets) {
    let best = null; let bestD = Infinity;
    for (const t of targets) {
      if (t.hp <= 0) continue;
      const d = Movement.distUnits(unit, t);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  }

  function getLowestHpTarget(targets) {
    let best = null; let bestHp = Infinity;
    for (const t of targets) {
      if (t.hp <= 0) continue;
      if (t.hp < bestHp) { bestHp = t.hp; best = t; }
    }
    return best;
  }

  function getHighestChanceTarget(unit, targets) {
    let best = null; let bestChance = -1;
    for (const t of targets) {
      if (t.hp <= 0) continue;
      const chance = estimateAttackSuccess(unit, t);
      if (chance > bestChance) { bestChance = chance; best = t; }
    }
    return best;
  }

  function estimateAttackSuccess(atk, def) {
    const needHit = atk.atkRange > 0 ? Combat.toHitShoot(atk.ct) : Combat.toHitMelee(atk.cc, def.cc);
    const hitProb = Math.max(0, (7 - needHit) / 6);
    const needWound = Combat.toWound(atk.f, def.e);
    const woundProb = Math.max(0, (7 - needWound) / 6);
    const sv = Combat.armorSave(def.armor, atk.armorPen || 0);
    const saveProb = sv == null ? 1 : Math.max(0, (sv - 1) / 6);
    return hitProb * woundProb * saveProb;
  }

  function getEffectiveStrategy(unit, allUnits) {
    if (unit.targetStrategy) return unit.targetStrategy;
    const nearbyUnits = allUnits.filter(u =>
      u !== unit && u.side === unit.side && u.hp > 0 && Movement.distUnits(unit, u) <= 60
    );
    if (nearbyUnits.length === 0) return TARGET_STRATEGY.CLOSEST;
    let leader = nearbyUnits[0];
    for (const u of nearbyUnits) if (u.cd > leader.cd) leader = u;
    return leader.targetStrategy || TARGET_STRATEGY.CLOSEST;
  }

  function applyStrategyToUnit(unit, allies, foes, types, grid, now, allUnits) {
    if (unit._order === "manual") return;
    const isEnemy = unit.side === "foe";
    const validTargets = isEnemy ? allies.filter(a => a.hp > 0) : foes.filter(f => f.hp > 0);
    if (validTargets.length === 0) { unit._order = "stop"; return; }
    const effectiveStrategy = getEffectiveStrategy(unit, allUnits);
    let bestTarget = null;
    switch (effectiveStrategy) {
      case TARGET_STRATEGY.LOWEST_HP: bestTarget = getLowestHpTarget(validTargets); break;
      case TARGET_STRATEGY.HIGHEST_CHANCE: bestTarget = getHighestChanceTarget(unit, validTargets); break;
      default: bestTarget = getClosestTarget(unit, validTargets);
    }
    if (!bestTarget) { unit._order = "stop"; return; }
    const inMelee = Movement.distUnits(unit, bestTarget) <= 40;
    const inRange = unit.atkRange > 0 && Movement.distUnits(unit, bestTarget) <= unit.atkRange;
    if (unit.atkRange > 0) {
      const los = Movement.lineOfSight(types, grid, unit, bestTarget);
      if (inMelee || (inRange && los)) { unit._path = []; unit._target = bestTarget; unit._order = "attack"; }
      else if (!unit._path || unit._path.length === 0) orderMove(unit, types, grid, { col: bestTarget.col, row: bestTarget.row });
    } else {
      if (inMelee) { unit._path = []; unit._target = bestTarget; unit._order = "attack"; }
      else if (!unit._path || unit._path.length === 0) orderMove(unit, types, grid, { col: bestTarget.col, row: bestTarget.row });
    }
  }

  function aiTick(unit, allies, foes, types, grid, now, allUnits) {
    applyStrategyToUnit(unit, allies, foes, types, grid, now, allUnits);
  }

  function setUnitTargetStrategy(unit, strategy) {
    if (TARGET_STRATEGY[strategy]) { unit.targetStrategy = strategy; return true; }
    return false;
  }

  function setSideTargetStrategy(side, strategy, allUnits) {
    if (!TARGET_STRATEGY[strategy]) return false;
    for (const unit of allUnits) if (unit.side === side) unit.targetStrategy = strategy;
    return true;
  }

  window.Interactions = {
    abilitiesFor, select, getSelected, orderMove, orderAttack, orderStop,
    castAbility, isAbilityReady, TARGET_STRATEGY, setUnitTargetStrategy,
    setSideTargetStrategy, getEffectiveStrategy, aiTick,
    getClosestTarget, getLowestHpTarget, getHighestChanceTarget, estimateAttackSuccess
  };
})();

/* ============================================================
   combat.js — Résolution de combat temps réel (Warhammer TOW)
   ------------------------------------------------------------
   Tables officielles TOW (To-Hit, To-Wound, Armor Save) extraites
   du PDF "Feuille de référence Warhammer TOW". Pas de phases :
   le combat est résolu en continu, l'Initiative devient la cadence
   d'attaque (cooldown en ms).

   Dépendances : aucune (module pur). Doit être chargé AVANT le main.
   Expose window.Combat.
   ============================================================ */
(function () {
  "use strict";

  // ---- Tables TOW (indexées par différence attaquant-défense) ----
  const TO_HIT_MELEE = {
    "-4": 5, "-3": 4, "-2": 4, "-1": 4, "0": 4, "1": 3, "2": 3, "3": 2, "4": 2,
  };
  function toHitMelee(ccAtk, ccDef) {
    const d = clamp(ccAtk - ccDef, -4, 4);
    return TO_HIT_MELEE[String(d)] ?? 4;
  }

  const TO_HIT_SHOOT = { 1: 6, 2: 5, 3: 4, 4: 4, 5: 3, 6: 3, 7: 2, 8: 2, 9: 2, 10: 2 };
  function toHitShoot(ct) { return TO_HIT_SHOOT[clamp(ct, 1, 10)] ?? 4; }

  const TO_WOUND = { "-3": 6, "-2": 5, "-1": 4, "0": 4, "1": 3, "2": 3, "3": 2, "4": 2, "5": 2 };
  function toWound(fAtk, eDef) {
    const d = clamp(fAtk - eDef, -3, 5);
    return TO_WOUND[String(d)] ?? 4;
  }

  function armorSave(baseSave, armorPen) {
    if (baseSave == null || baseSave <= 0) return null;
    let s = baseSave - (armorPen || 0);
    if (s > 6) return null;
    return clamp(s, 2, 6);
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function rollD6() { return 1 + Math.floor(Math.random() * 6); }

  // ---- Conversion profil Warhammer -> stats de jeu ----
  function mkProfile(u) {
    const p = u.profile || {};
    const I = num(p.I), M = num(p.M);
    return {
      id: u.id, name: u.name,
      cc: num(p.CC), ct: num(p.CT), f: num(p.F), e: num(p.E),
      pv: num(p.PV), i: I, a: num(p.A), cd: num(p.Cd),
      hp: Math.max(1, num(p.PV) * 12),
      speed: Math.max(20, M * 14),
      atkRange: 0,
      atkCooldown: Math.max(300, Math.round(1600 / Math.max(0.5, I / 4))),
      armor: armorValueFromEquipment(u.equipment || []),
      rules: u.rules || u.specialRules || [],
      isHero: (u.category === "Personnages"),
      type: u.type || "Infanterie",
    };
  }

  function num(v) { const n = Number(v); return isNaN(n) ? 0 : n; }

  function armorValueFromEquipment(eq) {
    let save = 0;
    if (eq.includes("Armure intégrale")) save = 4;
    else if (eq.includes("Armure lourde")) save = 4;
    else if (eq.includes("Armure légère")) save = 5;
    if (eq.includes("Bouclier") || eq.includes("Boucliers")) save = Math.max(2, save - 1);
    if (eq.includes("Cape en peau de Dragon des Mers")) save = Math.max(2, save - 1);
    return save || 0;
  }

  function resolveAttack(atk, def, ctx) {
    ctx = ctx || {};
    let hits = 0, wounds = 0, unsaved = 0;
    const attacks = atk.a || 1;
    const ranged = ctx.ranged === true;
    for (let i = 0; i < attacks; i++) {
      const needHit = ranged ? toHitShoot(atk.ct) : toHitMelee(atk.cc, def.cc);
      if (rollD6() >= needHit) {
        hits++;
        const needWound = toWound(atk.f, def.e);
        if (rollD6() >= needWound) {
          wounds++;
          const sv = armorSave(def.armor, atk.armorPen || 0);
          if (sv == null || rollD6() < sv) unsaved++;
        }
      }
    }
    return { hits, wounds, unsaved, dmg: unsaved };
  }

  function attackReady(unit, now) { return (unit._lastAtk || 0) + unit.atkCooldown <= now; }
  function inRange(atk, def, distPx) { const r = atk.atkRange || 0; if (r === 0) return distPx <= 36; return distPx <= r; }

  window.Combat = {
    toHitMelee, toHitShoot, toWound, armorSave,
    rollD6, mkProfile, resolveAttack, attackReady, inRange, clamp,
  };
})();

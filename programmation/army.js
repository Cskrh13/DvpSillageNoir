/* ============================================================
   army.js — Catalogue d'armée + construction/validation de liste
   ------------------------------------------------------------
   Charge les JSON sous data/armies/ (armée de base + supplément),
   fusionne les unités du supplément par-dessus l'armée de base,
   applique les restrictions (allowedUnits/excludedUnits/categories %
   et maxPer1000) du supplément, et expose une API pour construire
   une liste de joueur sur le modèle du Generateur.html.

   Dépendances : aucune. Expose window.Army.
   ============================================================ */
(function () {
  "use strict";

  const BASE = "data/armies/elfes-noirs.json";
  const SUPP = "data/armies/maree-de-sang.json";
  const HIGH = "data/armies/hauts-elfes.json";

  let catalogue = null;

  async function load() {
    const [base, supp, high] = await Promise.all([
      fetch(BASE).then(r => r.json()),
      fetch(SUPP).then(r => r.json()),
      fetch(HIGH).then(r => r.json()),
    ]);
    const units = new Map();
    for (const u of base.units || []) units.set(u.id, u);
    for (const u of high.units || []) units.set(u.id, u);
    for (const u of supp.units || []) units.set(u.id, u);
    catalogue = {
      base, supp, high, units,
      allowed: new Set(supp.allowedUnits || []),
      excluded: new Set(supp.excludedUnits || []),
      restrictions: supp.restrictions || {},
    };
    return catalogue;
  }

  function get() { return catalogue; }

  function availableUnits() {
    if (!catalogue) return [];
    const out = [];
    for (const u of catalogue.units.values()) {
      if (catalogue.excluded.has(u.id)) continue;
      if (catalogue.allowed.size && !catalogue.allowed.has(u.id)) continue;
      out.push(u);
    }
    return out;
  }

  function buildList(name, format, entries) {
    if (!catalogue) throw new Error("Catalogue non chargé");
    const units = [];
    let total = 0;
    const catPoints = {};
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const u = catalogue.units.get(e.id);
      if (!u) continue;
      if (catalogue.excluded.has(u.id)) continue;
      if (catalogue.allowed.size && !catalogue.allowed.has(u.id)) continue;
      const pts = computePoints(u, e.size, e.options);
      units.push({ uid: "u" + (i + 1), id: u.id, name: u.name, size: e.size, options: e.options || {}, category: u.category, points: pts });
      total += pts;
      catPoints[u.category] = (catPoints[u.category] || 0) + pts;
    }
    return { name, format, supplement: catalogue.supp.id, army: catalogue.base.id, units, totalPoints: total };
  }

  function computePoints(u, size, options) {
    const perModel = u.points;
    let pts = (u.category === "Personnages" || u.unitSize === "1") ? perModel : perModel * (size || 1);
    return pts;
  }

  window.Army = { load, get, availableUnits, buildList, computePoints };
})();

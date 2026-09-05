/* ============================================================
   terrain-gen.js — Génération de terrain (carte de combat)
   ------------------------------------------------------------
   1. Le fond de carte mélange plusieurs terrains "normaux"
      (herbe / terre / sable) en grandes plaques organiques,
      au lieu d'un seul type uniforme pour toute la carte.
   2. Des espaces d'eau (eau peu profonde + eau profonde) sont
      posés par-dessus le fond, sous forme de lacs/étangs.
   3. Des espaces de pierre (rochers) sont posés par-dessus le
      fond, mais jamais sur l'eau.
   4. Des ruines sont posées sur (une partie de) ces espaces de
      pierre : c'est la seule chose qui peut aussi déborder sur
      l'eau (ruines à moitié englouties / en bord de rive).
   5. Des zones de bois sont posées uniquement sur les cases de
      terre ou d'herbe (jamais sur le sable, l'eau, la pierre ou
      les ruines).

   Les cases ne portent aucune image en elles-mêmes : c'est
   test-combat.html (buildDecor(), DVP_ASSETS) qui, en lisant les
   types de cases retournés ici (bois/arbres, rochers, ruines,
   herbe/terre/sable...), y pose les sprites correspondants
   (arbres, buissons, rochers, ruines...) via
   data/images/sprites/terrainsGen*.png. Ce fichier décide
   seulement QUEL type de terrain se trouve sur chaque case.
   ============================================================ */
(function () {
  "use strict";

  function makeRng(seed) {
    let s = (seed >>> 0) || 12345;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function hash(x, y, seed) {
    let n = (x * 374761393 + y * 668265263 + seed * 69069) | 0;
    n = (n ^ (n >>> 13)) * 1274126177;
    n = (n ^ (n >>> 16)) >>> 0;
    return n / 4294967296;
  }

  // Bruit de valeur lissé : sert à la fois au mélange du fond de carte et au
  // bruitage du contour des zones (eau, bois, pierre, ruines...), pour éviter
  // les frontières géométriques nettes.
  function smooth01(t) { return t * t * (3 - 2 * t); }
  function valueNoise(x, y, seed, scale) {
    const gx = x / scale, gy = y / scale;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const x1 = x0 + 1, y1 = y0 + 1;
    const sx = smooth01(gx - x0), sy = smooth01(gy - y0);
    const n00 = hash(x0, y0, seed), n10 = hash(x1, y0, seed);
    const n01 = hash(x0, y1, seed), n11 = hash(x1, y1, seed);
    const ix0 = n00 + (n10 - n00) * sx, ix1 = n01 + (n11 - n01) * sx;
    return ix0 + (ix1 - ix0) * sy;
  }

  const isWater = (id) => id === "eau" || id === "profonde";

  /**
   * Pose une zone à peu près ovale, centrée en (cx,cy), avec un contour
   * bruité (jamais un cercle parfait). `assign(cur, dist, x, y)` décide de
   * la valeur à écrire (ou de ne rien faire en retournant une valeur
   * falsy) et peut donc filtrer selon la case déjà présente (`cur`) et/ou
   * varier selon la distance au centre (ex : cœur en eau profonde, bord en
   * eau peu profonde).
   */
  function stampBlob(grid, w, h, cx, cy, radius, flatten, seed, assign) {
    const rx = radius * (0.85 + hash(seed, 1, seed) * 0.4);
    const ry = radius * flatten * (0.85 + hash(seed, 2, seed) * 0.4);
    const noiseScale = Math.max(2, radius * 0.35);
    const minX = Math.max(0, Math.floor(cx - rx - noiseScale * 2));
    const maxX = Math.min(w - 1, Math.ceil(cx + rx + noiseScale * 2));
    const minY = Math.max(0, Math.floor(cy - ry - noiseScale * 2));
    const maxY = Math.min(h - 1, Math.ceil(cy + ry + noiseScale * 2));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx, dy = y - cy;
        const dist = Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
        const edgeNoise = (valueNoise(x, y, seed, noiseScale) - 0.5) * 0.8;
        const d = dist + edgeNoise;
        if (d < 1) {
          const v = assign(grid[y][x], d, x, y);
          if (v) grid[y][x] = v;
        }
      }
    }
  }

  /**
   * Génère une grille [h][w] de terrain.
   * @param {number} w largeur en cases
   * @param {number} h hauteur en cases
   * @param {number} seed graine de génération
   * @returns {string[][]} grille de terrain
   */
  function generate(w, h, seed) {
    const S = seed || 12345;
    const rnd = makeRng(S);

    // ---- 1) Fond de carte : mélange de plusieurs terrains "normaux" -------
    // Herbe / terre / sable, en grandes plaques organiques (bruit à basse
    // fréquence), au lieu d'un seul type uniforme pour toute la carte.
    const baseScale = Math.max(6, Math.round(Math.min(w, h) * 0.22));
    // Petites variations des seuils d'une carte à l'autre, pour que la
    // proportion herbe/terre/sable change aussi d'une bataille à l'autre.
    const herbeCut = 0.42 + rnd() * 0.12;              // ~0.42–0.54
    const terreCut = herbeCut + 0.30 + rnd() * 0.10;   // au-delà = sable
    const grid = [];
    for (let y = 0; y < h; y++) {
      const row = [];
      for (let x = 0; x < w; x++) {
        const n = valueNoise(x, y, S + 401, baseScale);
        row.push(n < herbeCut ? "herbe" : (n < terreCut ? "terre" : "sable"));
      }
      grid.push(row);
    }

    // ---- 2) Espaces d'eau (lacs/étangs) ------------------------------------
    // Posés par-dessus le fond, sans condition (l'eau peut recouvrir
    // n'importe quel terrain de fond). Cœur en eau profonde, pourtour en
    // eau peu profonde.
    const waterCount = rnd() < 0.65 ? 1 : (rnd() < 0.5 ? 0 : 2);
    const waterRadius = Math.max(4, Math.round(Math.min(w, h) * 0.10));
    for (let i = 0; i < waterCount; i++) {
      const wseed = (S + i * 104729 + 11) >>> 0;
      const wrnd = makeRng(wseed);
      const cx = w * 0.18 + wrnd() * w * 0.64;
      const cy = h * 0.18 + wrnd() * h * 0.64;
      const radius = waterRadius * (0.8 + wrnd() * 0.9);
      stampBlob(grid, w, h, cx, cy, radius, 0.6, wseed, (cur, d) => {
        return d < 0.45 ? "profonde" : "eau";
      });
    }

    // ---- 3) Espaces de pierre ("rochers") ----------------------------------
    // Jamais posés sur l'eau : on garde la case telle quelle si elle est
    // déjà de l'eau.
    const stoneCount = rnd() < 0.7 ? 1 : 2;
    const stoneRadius = Math.max(3, Math.round(Math.min(w, h) * 0.075));
    const stoneZones = [];
    for (let i = 0; i < stoneCount; i++) {
      const sseed = (S + i * 65599 + 5000) >>> 0;
      const srnd = makeRng(sseed);
      const cx = w * 0.2 + srnd() * w * 0.6;
      const cy = h * 0.2 + srnd() * h * 0.6;
      const radius = stoneRadius * (0.8 + srnd() * 0.7);
      stoneZones.push({ cx, cy, radius, seed: sseed });
      stampBlob(grid, w, h, cx, cy, radius, 0.65, sseed, (cur) => {
        if (isWater(cur)) return null; // rien sur l'eau
        return "rochers";
      });
    }

    // ---- 4) Ruines, situées sur les espaces de pierre ----------------------
    // Sous-zone plus petite, centrée dans (ou juste à côté de) chaque zone
    // de pierre. C'est la seule chose autorisée à déborder sur l'eau
    // (ruines à moitié englouties / en bord de rive).
    for (const zone of stoneZones) {
      if (rnd() < 0.15) continue; // toutes les zones de pierre n'ont pas de ruines
      const rseed = (zone.seed ^ 0x2545f491) >>> 0;
      const rrnd = makeRng(rseed);
      const offAngle = rrnd() * Math.PI * 2, offDist = zone.radius * 0.25 * rrnd();
      const cx = zone.cx + Math.cos(offAngle) * offDist;
      const cy = zone.cy + Math.sin(offAngle) * offDist;
      const radius = zone.radius * (0.45 + rrnd() * 0.25);
      stampBlob(grid, w, h, cx, cy, radius, 0.6, rseed, () => "ruines");
    }

    // ---- 5) Bois, uniquement sur les espaces de terre ou d'herbe -----------
    // On ne recouvre jamais le sable, l'eau, la pierre ou les ruines : si la
    // case n'est pas "terre" ou "herbe" au moment du passage, on la laisse
    // telle quelle.
    const forestCount = rnd() < 0.5 ? 1 : 2;
    const baseRadius = Math.max(4, Math.round(Math.min(w, h) * 0.12));
    for (let i = 0; i < forestCount; i++) {
      const fseed = (S + i * 7919 + 1) >>> 0;
      const frnd = makeRng(fseed);
      const cx = w * 0.25 + frnd() * w * 0.5;
      const cy = h * 0.25 + frnd() * h * 0.5;
      const radius = baseRadius * (0.8 + frnd() * 0.6);
      stampBlob(grid, w, h, cx, cy, radius, 0.55, fseed, (cur) => {
        return (cur === "terre" || cur === "herbe") ? "bois" : null;
      });
    }

    return grid;
  }

  window.TerrainGen = { generate };
})();

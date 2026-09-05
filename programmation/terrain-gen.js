/* ============================================================
   terrain-gen.js — Génération de terrain (carte de combat)
   ------------------------------------------------------------
   Version volontairement simple, appelée par test-combat.html :
     1. Toute la carte est couverte d'un seul terrain de fond
        tiré au hasard entre "herbe" OU "terre" (pas de mélange).
     2. Une ou deux zones de "bois" sont posées sur la carte, avec un
        contour légèrement bruité pour éviter une lisière parfaite.
   Aucun autre décor (pas d'eau, ruines, colines, etc.) : ce fichier
   est une base volontairement minimale, à enrichir plus tard.

   Les cases "bois" ne portent aucune image en elles-mêmes : c'est
   test-combat.html (buildDecor(), DVP_ASSETS) qui, en trouvant des
   cases "bois"/"arbres" dans la grille retournée ici, y pose les
   sprites d'arbres réels découpés dans
   data/images/sprites/terrainsGen2.png (pineA/pineB/pineC, broadA,
   deadA, deadB + buissons). Ce fichier n'a donc besoin de connaître
   ni le chemin de l'image ni la découpe : il lui suffit de décider
   QUELLES cases sont "bois" pour que ces arbres apparaissent.
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

  // Bruit de valeur lissé, utilisé pour bruiter le contour des zones de bois
  // (pas pour choisir le fond de carte).
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

  // Pose une zone de "bois" à peu près ovale, centrée en (cx,cy), avec un
  // contour bruité (jamais un cercle parfait). Écrit directement dans grid.
  function stampForest(grid, w, h, cx, cy, radius, seed) {
    const rx = radius * (0.85 + hash(seed, 1, seed) * 0.4);
    const ry = radius * (0.55 + hash(seed, 2, seed) * 0.3); // aplati pour l'iso
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
        if (dist + edgeNoise < 1) grid[y][x] = "bois";
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

    // Fond de carte : herbe OU terre, jamais les deux mélangés.
    const baseId = rnd() < 0.5 ? "herbe" : "terre";
    const grid = [];
    for (let y = 0; y < h; y++) {
      grid.push(new Array(w).fill(baseId));
    }

    // Une ou deux zones de bois, placées loin des bords pour ne pas être
    // tronquées, avec un rayon proportionnel à la taille de la carte.
    const forestCount = rnd() < 0.5 ? 1 : 2;
    const baseRadius = Math.max(4, Math.round(Math.min(w, h) * 0.12));
    for (let i = 0; i < forestCount; i++) {
      const cx = w * 0.25 + rnd() * w * 0.5;
      const cy = h * 0.25 + rnd() * h * 0.5;
      const radius = baseRadius * (0.8 + rnd() * 0.6);
      stampForest(grid, w, h, cx, cy, radius, (S + i * 7919 + 1) >>> 0);
    }

    return grid;
  }

  window.TerrainGen = { generate };
})();

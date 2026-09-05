/* ============================================================
   terrain-gen.js — Génération de terrain (carte de combat)
   ------------------------------------------------------------
   Version volontairement simple, appelée par test-combat.html :
     1. Toute la carte est couverte d'un seul terrain de fond
        tiré au hasard entre "herbe" OU "terre" (pas de mélange).
     2. Un unique cercle de "bois" est posé sur la carte, avec un
        contour légèrement bruité pour éviter une lisière parfaite.
   Aucun autre décor (pas d'eau, ruines, colines, etc.) : ce fichier
   est une base volontairement minimale, à enrichir plus tard.
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

  // Bruit de valeur lissé (utilisé uniquement pour bruiter le contour du
  // cercle de bois, pas pour choisir le fond de carte).
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

  /**
   * Génère une grille [h][w] de terrain.
   * @param {number} w largeur en cases
   * @param {number} h hauteur en cases
   * @param {number} seed graine de génération
   * @returns {string[][]} grille de terrain
   *
   * NOTE : la génération par cercles (forêt, etc.) a été retirée — elle est
   * remplacée par le système d'aplats qui se chevauchent (voir
   * programmation/terrain-stamps.js). Cette fonction ne fournit plus qu'un
   * fond uniforme herbe OU terre, utilisé pour la grille de gameplay
   * (déplacement, pathfinding), pendant que le rendu visuel est assuré par
   * terrain-stamps.js.
   */
  function generate(w, h, seed) {
    const rnd = makeRng(seed || 12345);

    // Fond de carte : herbe OU terre, jamais les deux mélangés.
    const baseId = rnd() < 0.5 ? "herbe" : "terre";
    const grid = [];
    for (let y = 0; y < h; y++) {
      grid.push(new Array(w).fill(baseId));
    }

    return grid;
  }

  window.TerrainGen = { generate };
})();

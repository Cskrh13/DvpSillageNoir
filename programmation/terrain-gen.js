/* ============================================================
   terrain-gen.js — Génération de terrain (carte de combat)
   ------------------------------------------------------------
   1. Le fond de carte mélange plusieurs terrains "normaux"
      (herbe / terre) en grandes plaques organiques, au lieu
      d'un seul type uniforme pour toute la carte.
   2. Des espaces d'eau (eau peu profonde + eau profonde) sont
      posés par-dessus le fond, sous forme de lacs/étangs.
   2b. Le "sable" n'est plus une grande plaque aléatoire : c'est
      la frontière (rive) entre l'eau et l'herbe/la terre —
      cf. l'asset ligne 3, colonne 2 de terrainsGen2.png, qui est
      précisément ce tuile de bordure. Toute case herbe/terre
      directement au contact de l'eau devient donc "sable".
   3. Des espaces de pierre (rochers) sont posés par-dessus le
      fond, mais jamais sur l'eau. Les cases de pierre qui
      touchent directement l'eau deviennent des "falaises"
      (même famille que "rochers" niveau jeu, mais rendues avec
      les sprites de falaise/cascade de terrainsGen2.png).
   4. Des ruines (bâtiments en ruine, rows 9/10/11 du bas de
      terrainsGen2.png) sont posées en DÉCOR, par-dessus le sol
      existant (elles ne remplacent plus le type de case), sous
      forme de petits cercles de 2 à 10 éléments. Leur centre
      peut être choisi sur de la terre, de l'herbe ou de l'eau.
   5. Des zones de bois sont posées uniquement sur les cases de
      terre ou d'herbe (jamais sur le sable, l'eau, la pierre,
      les falaises ou les ruines).

   Les cases ne portent (presque) aucune image en elles-mêmes :
   c'est test-combat.html (buildDecor(), DVP_ASSETS) qui, en
   lisant les types de cases retournés ici (bois/arbres,
   rochers/falaises, herbe/terre/sable...) ainsi que la liste
   grid.ruinCircles (cercles de ruines), y pose les sprites
   correspondants (arbres, buissons, rochers, falaises,
   ruines...) via data/images/sprites/terrainsGen*.png. Ce
   fichier décide seulement QUEL type de terrain se trouve sur
   chaque case, et OÙ poser les cercles de ruines.
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
    // Herbe / terre, en grandes plaques organiques (bruit à basse
    // fréquence), au lieu d'un seul type uniforme pour toute la carte.
    // (Le sable n'est plus tiré ici : voir l'étape 2b, il ne représente que
    // la rive au contact de l'eau.)
    const baseScale = Math.max(6, Math.round(Math.min(w, h) * 0.22));
    // Petite variation du seuil d'une carte à l'autre, pour que la
    // proportion herbe/terre change aussi d'une bataille à l'autre.
    const herbeCut = 0.46 + rnd() * 0.18; // ~0.46–0.64
    const grid = [];
    for (let y = 0; y < h; y++) {
      const row = [];
      for (let x = 0; x < w; x++) {
        const n = valueNoise(x, y, S + 401, baseScale);
        row.push(n < herbeCut ? "herbe" : "terre");
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

    // ---- 2b) Rive : bordure sable entre l'eau et l'herbe/la terre ----------
    // Sprite dédié (terrainsGen2.png, ligne 3 colonne 2) : on ne le pose que
    // sur les cases herbe/terre directement au contact de l'eau, jamais
    // ailleurs — le sable n'est donc plus une plaque aléatoire mais un vrai
    // liseré de rivage.
    const shoreCells = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (grid[y][x] !== "herbe" && grid[y][x] !== "terre") continue;
        let touchesWater = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (isWater(grid[ny][nx])) { touchesWater = true; break; }
        }
        if (touchesWater) shoreCells.push([x, y]);
      }
    }
    for (const [x, y] of shoreCells) grid[y][x] = "sable";

    // ---- 3) Espaces de pierre ("rochers" / "falaises") ---------------------
    // Jamais posés sur l'eau : on garde la case telle quelle si elle est
    // déjà de l'eau. Une case de pierre directement au contact de l'eau
    // devient une "falaise" (mêmes règles de jeu que "rochers", mais rendue
    // avec les sprites de falaise/cascade de terrainsGen2.png).
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
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (grid[y][x] !== "rochers") continue;
        let touchesWater = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (isWater(grid[ny][nx])) { touchesWater = true; break; }
        }
        if (touchesWater) grid[y][x] = "falaises";
      }
    }

    // ---- 4) Ruines : cercles de décor (2 à 10 éléments) ---------------------
    // Ne modifient plus le type de case : ce sont des éléments de décor
    // (rows 9/10/11 du bas de terrainsGen2.png — tours, arches, piliers,
    // bâtisses, chariots, palissades...) posés en cercle par-dessus le sol
    // existant. Le centre du cercle est choisi sur de la terre, de l'herbe
    // ou de l'eau (ruines à moitié englouties comprises).
    const ruinCircles = [];
    const ruinAnchorOk = (cur) => cur === "herbe" || cur === "terre" || isWater(cur);
    const ruinCount = rnd() < 0.5 ? 1 : (rnd() < 0.7 ? 2 : 3);
    for (let i = 0; i < ruinCount; i++) {
      const rseed = (S + i * 40503 + 9001) >>> 0;
      const rrnd = makeRng(rseed);
      let cx = 0, cy = 0, found = false;
      for (let tries = 0; tries < 40 && !found; tries++) {
        cx = Math.floor(w * 0.12 + rrnd() * w * 0.76);
        cy = Math.floor(h * 0.12 + rrnd() * h * 0.76);
        if (ruinAnchorOk(grid[cy][cx])) found = true;
      }
      if (!found) continue; // pas trouvé d'ancrage valable sur cette carte
      const count = 2 + Math.floor(rrnd() * 9); // 2 à 10 éléments
      const radius = 1.4 + rrnd() * 1.8;
      ruinCircles.push({ cx: cx + 0.5, cy: cy + 0.5, count, radius, seed: rseed });
    }

    // ---- 5) Bois, uniquement sur les espaces de terre ou d'herbe -----------
    // On ne recouvre jamais le sable, l'eau, la pierre/falaise : si la
    // case n'est pas "terre" ou "herbe" au moment du passage, on la laisse
    // telle quelle. (Les ruines n'étant plus un type de case, elles ne
    // bloquent plus le bois ici — mais les deux peuvent désormais se
    // superposer visuellement, ce qui est voulu.)
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

    // Les cercles de ruines sont attachés à la grille (plutôt que renvoyés à
    // part) pour ne rien changer à la signature de generate() ni aux points
    // d'appel existants (test-combat.html lit `_grid.ruinCircles`).
    grid.ruinCircles = ruinCircles;

    return grid;
  }

  window.TerrainGen = { generate };
})();

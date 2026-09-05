/* ============================================================
   sprites.js — Gestionnaire de sprites (1 PNG par unité)
   ------------------------------------------------------------
   Convention : chaque unité a son propre spritesheet dans
   /images/sprites/<unit-id>.png (768×1056, grille 8×11, cell 96×96).
   Layout :
     Ligne 0-7 : marche, 8 frames, dirs S/SE/E/NE/N/NO/O/SO
     Ligne 8   : attaque, 8 frames
     Ligne 9   : mort, 6 frames
     Ligne 10  : spécial héros, 6 frames (vide pour non-héros)

   Directions (iso, horaire) :
     0=S 1=SE 2=E 3=NE 4=N 5=NO 6=O 7=SO

   Expose window.Sprites.
   ============================================================ */
(function () {
  "use strict";

  const CELL = 96;
  const COLS = 8;
  const WALK_ROWS = 8;       // lignes 0-7
  const ATK_ROW = 8;
  const DEATH_ROW = 9;
  const SPEC_ROW = 10;
  const DEATH_FRAMES = 6;
  const SPEC_FRAMES = 6;

  const SPRITE_DIR = "images/sprites/";   // sans extension, .png ajouté

  // ---- Layouts de spritesheet ----
  // "full"      : format cible complet, 8 colonnes x 11 lignes, cellules 96x96 (voir en-tête).
  // "cardinal4" : format réduit utilisé pour les premières planches générées : 4 colonnes (frames)
  //               x 8 lignes, 4 directions cardinales uniquement (pas de diagonales, pas d'attaque
  //               dédiée, pas de stand/hold). Lignes 0-3 = marche N/S/E/O, lignes 4-7 = mort N/S/E/O.
  const LAYOUTS = {
    full: { type: "full", cols: COLS, rows: 11 },
    cardinal4: {
      type: "cardinal4", cols: 4, rows: 8,
      // Cellule "utile" fixée à 100x100, ancrée en haut à gauche de chaque case de la grille.
      // La grille brute a des cases un peu plus grandes (ex: 102 px de large) avec du vide en
      // trop à droite/en bas : il ne faut PAS échantillonner sur la largeur totale de la case
      // (naturalWidth/cols) sous peine de dérive cumulative d'une frame à l'autre.
      cellW: 100, cellH: 100,
      walkRow:  { N: 0, S: 1, E: 2, O: 3 },
      deathRow: { N: 4, S: 5, E: 6, O: 7 },
    },
  };

  // Association unitId -> clé de layout. Par défaut "full".
  const UNIT_LAYOUT = {
    "warriorDE": "cardinal4",
  };

  // Association unitId -> chemin explicite du fichier (sinon SPRITE_DIR + id + ".png").
  const UNIT_SHEET_PATH = {
    "warriorDE": "data/images/units/warriorDE.png",
  };

  function layoutFor(unitId) {
    return LAYOUTS[UNIT_LAYOUT[unitId] || "full"];
  }

  // 8 secteurs (0=S..7=SO, cf. dirFromDelta) -> 1 des 4 directions cardinales,
  // chaque cardinale couvrant les 2 secteurs les plus proches d'elle.
  const CARDINAL_FROM_DIR = ["S", "E", "E", "N", "N", "O", "O", "S"];
  function toCardinal(dir) { return CARDINAL_FROM_DIR[((dir % 8) + 8) % 8]; }

  // ---- Métadonnées de découpe par feuille chargée (calculées depuis la taille réelle de l'image) ----
  const sheetMeta = new Map(); // unitId -> { cols, rows, cellW, cellH, layout }

  // ---- Caches ----
  const sheets = new Map();   // unitId -> HTMLImageElement
  const loading = new Map();  // unitId -> Promise

  // ---- Héros (ont une ligne spéciale) ----
  const HEROES = new Set(["maldris-dravelyth", "moraveth-dravelyth", "kharyx"]);

  // ---- Images de fond ----
  const BG_DIR = "data/images/";
  const BG_FILES = {
    arche:   BG_DIR + "ArcheNoire.png",
    conseil: BG_DIR + "Conseil.png",
    maree:   BG_DIR + "MareeDeSang.png",
    proue:   BG_DIR + "Proue.png",
  };
  const bgImgs = {};

  // ---- Chargement ----
  function loadImg(url) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error("Image injoignable: " + url));
      img.src = url;
    });
  }

  // Charge (ou retourne le cache) le spritesheet d'une unité
  function loadSheet(unitId) {
    if (sheets.has(unitId)) return Promise.resolve(sheets.get(unitId));
    if (loading.has(unitId)) return loading.get(unitId);
    const path = UNIT_SHEET_PATH[unitId] || (SPRITE_DIR + unitId + ".png");
    const p = loadImg(path).then(img => {
      sheets.set(unitId, img);
      const layout = layoutFor(unitId);
      // pitchX/pitchY = pas de la grille brute (peut inclure du vide en trop dans chaque case),
      // utilisé uniquement pour localiser le coin haut-gauche de chaque case.
      // cellW/cellH = taille réellement échantillonnée à partir de ce coin haut-gauche : si le
      // layout impose une taille fixe (ex: cardinal4, sprite 100x100 dans une case plus grande),
      // on l'utilise telle quelle plutôt que de diviser la taille de l'image par cols/rows.
      const pitchX = img.naturalWidth / layout.cols;
      const pitchY = img.naturalHeight / layout.rows;
      sheetMeta.set(unitId, {
        cols: layout.cols,
        rows: layout.rows,
        pitchX, pitchY,
        cellW: layout.cellW || pitchX,
        cellH: layout.cellH || pitchY,
        layout,
      });
      loading.delete(unitId);
      return img;
    }).catch(err => {
      loading.delete(unitId);
      console.warn("Sprite manquant:", unitId, err);
      return null;
    });
    loading.set(unitId, p);
    return p;
  }

  // Précharge une liste d'unités (appelé au spawn)
  function preload(unitIds) {
    return Promise.allSettled(unitIds.map(loadSheet));
  }

  // Initialise les fonds (appelé au démarrage)
  async function init() {
    const tasks = Object.entries(BG_FILES).map(([k, url]) =>
      loadImg(url).then(img => bgImgs[k] = img).catch(() => {})
    );
    await Promise.allSettled(tasks);
  }

  // ---- Extraction de frame ----
  // unitId, row, frame, retourne {img, sx, sy, sw, sh} en tenant compte de la taille réelle des cellules.
  function frame(unitId, row, frameIdx) {
    const img = sheets.get(unitId);
    const meta = sheetMeta.get(unitId);
    if (!img || !meta) return null;
    const sx = (frameIdx % meta.cols) * meta.pitchX;
    const sy = row * meta.pitchY;
    return { img, sx, sy, sw: meta.cellW, sh: meta.cellH };
  }

  // ---- Rendu d'une unité ----
  // unit = { id, _frame (0-7), _dir (0-7), _state ("walk"|"atk"|"death"|"spec"), _deathFrame, _specFrame }
  function drawUnit(ctx, unit, x, y) {
    const img = sheets.get(unit.id);
    const meta = sheetMeta.get(unit.id);
    if (!img || !meta) return false; // fallback procédural à faire par l'appelant

    let row, frameIdx;
    const dir = unit._dir ?? 0;
    const state = unit._state || "walk";

    if (meta.layout.type === "cardinal4") {
      // Format réduit : 4 directions cardinales, pas d'attaque/stand/hold dédiés.
      const card = toCardinal(dir);
      const cols = meta.cols;
      if (state === "death") {
        row = meta.layout.deathRow[card];
        frameIdx = Math.min(unit._deathFrame || 0, cols - 1);
      } else if (state === "atk") {
        // Pas de ligne d'attaque dans ce format : on retombe sur la marche dans la même direction.
        row = meta.layout.walkRow[card];
        frameIdx = (unit._atkFrame || 0) % cols;
      } else {
        // "walk", "spec" (non supporté ici) ou tout autre état : marche.
        row = meta.layout.walkRow[card];
        frameIdx = (unit._frame || 0) % cols;
      }
    } else {
      // Format complet (8 colonnes x 11 lignes).
      if (state === "walk") {
        row = dir % WALK_ROWS;
        frameIdx = (unit._frame || 0) % 8;
      } else if (state === "atk") {
        row = ATK_ROW;
        frameIdx = (unit._atkFrame || 0) % 8;
      } else if (state === "death") {
        row = DEATH_ROW;
        frameIdx = Math.min(unit._deathFrame || 0, DEATH_FRAMES - 1);
      } else if (state === "spec" && HEROES.has(unit.id)) {
        row = SPEC_ROW;
        frameIdx = Math.min(unit._specFrame || 0, SPEC_FRAMES - 1);
      } else {
        row = dir % WALK_ROWS;
        frameIdx = (unit._frame || 0) % 8;
      }
    }

    const f = frame(unit.id, row, frameIdx);
    if (!f) return false;
    const dw = meta.cellW, dh = meta.cellH;
    ctx.drawImage(f.img, f.sx, f.sy, f.sw, f.sh, x - dw / 2, y - dh, dw, dh);
    return true;
  }

  // ---- Animation helpers ----
  // Nombre de colonnes (frames) réellement disponibles pour une unité (8 en format complet, 4 en cardinal4).
  function colsFor(unit) {
    const meta = sheetMeta.get(unit.id);
    return meta ? meta.cols : 8;
  }
  function advanceWalk(unit, dt) {
    unit._frameT = (unit._frameT || 0) + dt;
    const cols = colsFor(unit);
    if (unit._frameT > 0.12) { unit._frameT = 0; unit._frame = ((unit._frame || 0) + 1) % cols; }
  }
  function startAttack(unit) {
    unit._state = "atk"; unit._atkFrame = 0; unit._atkT = 0;
  }
  function advanceAttack(unit, dt) {
    unit._atkT = (unit._atkT || 0) + dt;
    const speed = 0.08;
    const cols = colsFor(unit);
    if (unit._atkT > speed) { unit._atkT = 0; unit._atkFrame = (unit._atkFrame || 0) + 1; if (unit._atkFrame >= cols) { unit._state = "walk"; unit._atkFrame = 0; } }
  }
  function startDeath(unit) {
    unit._state = "death"; unit._deathFrame = 0; unit._deathT = 0;
  }
  function advanceDeath(unit, dt) {
    unit._deathT = (unit._deathT || 0) + dt;
    const meta = sheetMeta.get(unit.id);
    const maxFrames = meta && meta.layout.type === "cardinal4" ? meta.cols : DEATH_FRAMES;
    if (unit._deathT > 0.18 && (unit._deathFrame || 0) < maxFrames - 1) { unit._deathT = 0; unit._deathFrame = (unit._deathFrame || 0) + 1; }
  }
  function startSpecial(unit) {
    if (!HEROES.has(unit.id)) return false;
    unit._state = "spec"; unit._specFrame = 0; unit._specT = 0;
    return true;
  }
  function advanceSpecial(unit, dt) {
    unit._specT = (unit._specT || 0) + dt;
    if (unit._specT > 0.12 && (unit._specFrame || 0) < SPEC_FRAMES - 1) { unit._specT = 0; unit._specFrame = (unit._specFrame || 0) + 1; }
    if ((unit._specFrame || 0) >= SPEC_FRAMES - 1 && unit._specT > 0.6) { unit._state = "walk"; }
  }

  // ---- Tiles de terrain (inchangé, pas de tilesheet ici) ----
  function tile(typeId) { return null; } // fallback couleur dans terrain.js

  // ---- Fonds ----
  function background(id) { return bgImgs[id] || null; }
  function setBg(el, bgId, darkClass) {
    const img = background(bgId);
    if (img) { el.style.backgroundImage = `url("${img.src}")`; el.style.backgroundSize = "cover"; el.style.backgroundPosition = "center"; }
    else { el.style.backgroundImage = "linear-gradient(160deg,#0a0a12,#050508)"; }
    el.dataset.dark = darkClass || "";
  }

  // ---- Direction depuis delta de mouvement ----
  // dx, dy en pixels écran. Retourne 0-7.
  function dirFromDelta(dx, dy) {
    const angle = Math.atan2(dy, dx); // radians, 0 = +x (Est)
    // Iso : on mappe vers 8 secteurs dans l'ordre S,SE,E,NE,N,NO,O,SO
    // S = (0,+y), SE=(+x,+y), E=(+x,0), NE=(+x,-y), N=(0,-y), NO=(-x,-y), O=(-x,0), SO=(-x,+y)
    const deg = (angle * 180 / Math.PI + 360) % 360;
    // atan2: Est=0, Sud=90, Ouest=180, Nord=270
    // On veut: S=0, SE=45, E=90, NE=135, N=180, NO=225, O=270, SO=315
    const shifted = (deg - 90 + 360) % 360; // S=0 maintenant
    return Math.round(shifted / 45) % 8;
  }

  window.Sprites = {
    init, loadSheet, preload, frame, drawUnit, tile, background, setBg,
    advanceWalk, startAttack, advanceAttack, startDeath, advanceDeath,
    startSpecial, advanceSpecial, dirFromDelta, toCardinal,
    isHero: (id) => HEROES.has(id),
    CELL, COLS, WALK_ROWS,
  };
})();

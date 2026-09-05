/* ============================================================
   movement.js — Déplacement isométrique fluide + pathfinding A*
   ------------------------------------------------------------
   Carte stockée en grille (grid[y][x] = id de type de terrain).
   Conversion iso : screenX = (col - row) * tileW/2, screenY = (col+row)*tileH/2.

   Système de déplacement fluide (style Age of Empires) :
   - A* 8 directions (diagonales incluses, anti-coupe-diagonale)
   - Path smoothing : supprime les waypoints inutiles (ligne de vue)
   - Position libre en pixels (px, py), pas de snap de tuile
   - Vitesse modulée par le coefficient move du terrain

   Dépendances : aucune. Expose window.Movement.
   ============================================================ */
(function () {
  "use strict";

  const TW = 56, TH = 28;
  const DIRS8 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];

  /* ---- Coordonnées isométriques ---- */
  function gridToScreen(col, row) { return { x: (col - row) * (TW / 2), y: (col + row) * (TH / 2) }; }
  function screenToGrid(sx, sy, camX, camY) {
    const x = sx - (camX || 0), y = sy - (camY || 0);
    return { col: Math.floor((x / (TW / 2) + y / (TH / 2)) / 2),
             row: Math.floor((y / (TH / 2) - x / (TW / 2)) / 2) };
  }
  function pxToGrid(px, py) {
    return { col: Math.floor((px / (TW / 2) + py / (TH / 2)) / 2),
             row: Math.floor((py / (TH / 2) - px / (TW / 2)) / 2) };
  }

  /* ---- Tuiles ---- */
  function inBounds(grid, c, r) { return r >= 0 && c >= 0 && r < grid.length && c < grid[0].length; }
  function tilePassable(types, grid, c, r) {
    if (!inBounds(grid, c, r)) return false;
    const t = types[grid[r][c]];
    return t && !t.blocks;
  }
  function tileMoveMult(types, grid, c, r) {
    if (!inBounds(grid, c, r)) return 0;
    const t = types[grid[r][c]];
    return t ? t.move : 0;
  }

  /* ---- A* 8 directions ---- */
  function heuristic(c, r, gc, gr) { return Math.hypot(c - gc, r - gr); }

  function findPathTiles(types, grid, sc, sr, gc, gr) {
    if (!tilePassable(types, grid, gc, gr)) return null;
    const h = grid.length, w = grid[0].length, key = (c, r) => r * w + c;
    const open = new Map(), closed = new Set(), came = new Map(), g = new Map();
    const sk = key(sc, sr);
    g.set(sk, 0);
    open.set(sk, { col: sc, row: sr, f: heuristic(sc, sr, gc, gr) });
    while (open.size) {
      let curK = null, curF = Infinity;
      for (const [k, v] of open) if (v.f < curF) { curF = v.f; curK = k; }
      const cur = open.get(curK); open.delete(curK); closed.add(curK);
      if (cur.col === gc && cur.row === gr) {
        const path = []; let k = curK;
        while (k != null) { path.unshift({ col: k % w, row: Math.floor(k / w) }); k = came.get(k); }
        return path;
      }
      for (const [dc, dr] of DIRS8) {
        const nc = cur.col + dc, nr = cur.row + dr;
        if (!tilePassable(types, grid, nc, nr)) continue;
        // anti-coupe-diagonale : pas de coin à travers un mur
        if (dc !== 0 && dr !== 0) {
          if (!tilePassable(types, grid, cur.col + dc, cur.row) ||
              !tilePassable(types, grid, cur.col, cur.row + dr)) continue;
        }
        const nk = key(nc, nr);
        if (closed.has(nk)) continue;
        const moveC = tileMoveMult(types, grid, nc, nr) || 1;
        const stepCost = (dc !== 0 && dr !== 0) ? 1.414 / moveC : 1 / moveC;
        const tent = g.get(curK) + stepCost;
        if (tent < (g.get(nk) ?? Infinity)) {
          came.set(nk, curK); g.set(nk, tent);
          open.set(nk, { col: nc, row: nr, f: tent + heuristic(nc, nr, gc, gr) });
        }
      }
    }
    return null;
  }

  /* ---- Path smoothing : ligne de vue entre deux points écran ---- */
  function lineClear(types, grid, x1, y1, x2, y2) {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.ceil(dist / 6);
    if (steps === 0) return true;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const wx = x1 + (x2 - x1) * t, wy = y1 + (y2 - y1) * t;
      const g = pxToGrid(wx, wy);
      if (!tilePassable(types, grid, g.col, g.row)) return false;
    }
    return true;
  }

  function smoothPath(types, grid, path) {
    if (!path || path.length <= 2) return path;
    const result = [path[0]];
    let i = 0;
    while (i < path.length - 1) {
      let j = path.length - 1;
      while (j > i + 1) {
        const a = gridToScreen(path[i].col, path[i].row);
        const b = gridToScreen(path[j].col, path[j].row);
        if (lineClear(types, grid, a.x, a.y, b.x, b.y)) break;
        j--;
      }
      result.push(path[j]);
      i = j;
    }
    return result;
  }

  /* ---- API haut niveau : findPath fluide (pixels → waypoints pixels) ---- */
  // Retourne un tableau de waypoints {x, y} en pixels monde, ou null
  function findPath(types, grid, px, py, tx, ty) {
    const start = pxToGrid(px, py);
    const goal = pxToGrid(tx, ty);
    let raw = findPathTiles(types, grid, start.col, start.row, goal.col, goal.row);
    // si la tuile cible est bloquée, cherche la plus proche passable
    if (!raw) {
      for (let radius = 1; radius <= 8 && !raw; radius++) {
        for (let dy = -radius; dy <= radius && !raw; dy++) {
          for (let dx = -radius; dx <= radius && !raw; dx++) {
            if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
            const nc = goal.col + dx, nr = goal.row + dy;
            if (tilePassable(types, grid, nc, nr))
              raw = findPathTiles(types, grid, start.col, start.row, nc, nr);
          }
        }
      }
    }
    if (!raw) return null;
    const smoothed = smoothPath(types, grid, raw);
    // convertit en waypoints pixels (sauf le premier = position actuelle)
    const wps = [{ x: px, y: py }];
    for (let i = 1; i < smoothed.length; i++) {
      const s = gridToScreen(smoothed[i].col, smoothed[i].row);
      wps.push({ x: s.x, y: s.y });
    }
    // dernier waypoint = point exact cliqué
    wps[wps.length - 1] = { x: tx, y: ty };
    return wps;
  }

  /* ---- Ligne de vue (tuile à tuile, pour tirs / détection) ---- */
  function lineOfSight(types, grid, a, b) {
    let x0 = a.col, y0 = a.row, x1 = b.col, y1 = b.row;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      if (x0 === x1 && y0 === y1) return true;
      if (!(x0 === a.col && y0 === a.row) && !(x0 === b.col && y0 === b.row)) {
        const t = types[grid[y0]?.[x0]]; if (t && t.blocksView) return false;
      }
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }

  /* ---- Déplacement fluide d'une unité (modifie unit.px, unit.py) ---- */
  // unit possède : px, py (position monde), _path (waypoints {x,y}), speed
  function stepUnit(types, grid, unit, dt) {
    if (!unit._path || unit._path.length === 0) return true;
    const wp = unit._path[0];
    const dx = wp.x - unit.px, dy = wp.y - unit.py;
    const d = Math.hypot(dx, dy);
    if (d < 2) {
      unit.px = wp.x; unit.py = wp.y;
      unit._path.shift();
      return unit._path.length === 0;
    }
    unit._moveDx = dx / d; unit._moveDy = dy / d;
    const g = pxToGrid(unit.px, unit.py);
    const moveC = tileMoveMult(types, grid, g.col, g.row) || 1;
    const spd = (unit._groupSpeed || unit.speed || 60) * moveC;
    const step = spd * dt;
    if (step >= d) { unit.px = wp.x; unit.py = wp.y; unit._path.shift(); }
    else { unit.px += (dx / d) * step; unit.py += (dy / d) * step; }
    return false;
  }

  /* ---- Évitement entre unités (séparation / steering) ----
     Applique une force de répulsion sur chaque unité quand elle est trop proche
     d'autres unités. Modifie px/py directement. `units` = toutes les unités vivantes.
     `radius` = distance minimale souhaitée entre unités (défaut 28px).
     `push` = force de répulsion (0..1, défaut 0.5).
     `types`+`grid` = terrain (pour ne pas pousser sur un mur). */
  function separate(units, radius, push, types, grid) {
    const R = radius || 28, P = push ?? 0.5;
    const n = units.length;
    if (n < 2) return;
    for (let i = 0; i < n; i++) {
      const a = units[i];
      if (a.hp <= 0) continue;
      let fx = 0, fy = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const b = units[j];
        if (b.hp <= 0) continue;
        const dx = a.px - b.px, dy = a.py - b.py;
        const d2 = dx * dx + dy * dy;
        if (d2 < R * R && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const overlap = (R - d) / R;        // 0..1, plus c'est proche plus c'est fort
          fx += (dx / d) * overlap;
          fy += (dy / d) * overlap;
        }
      }
      if (fx !== 0 || fy !== 0) {
        const fm = Math.hypot(fx, fy);
        if (fm > 0) {
          const mx = (fx / fm) * P * Math.min(fm, 3);
          const my = (fy / fm) * P * Math.min(fm, 3);
          const nx = a.px + mx, ny = a.py + my;
          if (types && grid) {
            const g = pxToGrid(nx, ny);
            if (tilePassable(types, grid, g.col, g.row)) { a.px = nx; a.py = ny; }
            else {
              const gx = pxToGrid(a.px + mx, a.py);
              if (tilePassable(types, grid, gx.col, gx.row)) a.px += mx;
              else {
                const gy = pxToGrid(a.px, a.py + my);
                if (tilePassable(types, grid, gy.col, gy.row)) a.py += my;
              }
            }
          } else { a.px = nx; a.py = ny; }
        }
      }
    }
  }

  /* ---- Distance entre deux unités (en pixels monde) ---- */
  function distUnits(a, b) {
    return Math.hypot(a.px - b.px, a.py - b.py);
  }

  /* ---- Export ---- */
  window.Movement = {
    gridToScreen, screenToGrid, pxToGrid,
    inBounds, tilePassable, tileMoveMult,
    findPathTiles, findPath, smoothPath, lineClear,
    lineOfSight, stepUnit, separate, distUnits,
    heuristic, TILE_W: TW, TILE_H: TH,
  };
})();

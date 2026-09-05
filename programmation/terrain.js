/* ============================================================
   terrain.js — Génération & rendu du terrain enrichi
   ------------------------------------------------------------
   - génération cohérente par bruit déterministe / voisins
   - transitions visuelles et variantes décoratives
   - relief visuel pour collines/rochers/ruines
   - routes et zones de terrain plus naturelles
   - métadonnées gameplay : couvert, hauteur, danger
   ============================================================ */
(function () {
  "use strict";

  let TERRAIN = null;

  async function load(url) {
    const r = await fetch(url);
    TERRAIN = await r.json();
    return TERRAIN;
  }
  function get() { return TERRAIN; }

  function makeRng(seed) {
    let s = (seed >>> 0) || 12345;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function hash(x,y,seed) {
    let n = (x*374761393 + y*668265263 + seed*69069) | 0;
    n = (n ^ (n >>> 13)) * 1274126177;
    n = (n ^ (n >>> 16)) >>> 0;
    return n / 4294967296;
  }

  // Bruit de valeur lissé (interpolation smoothstep sur un lattice de hash).
  // Sert à la fois au mélange des terrains de base et au "bruitage" des
  // bords de zones, pour éviter les frontières géométriques nettes.
  function smooth01(t){ return t*t*(3-2*t); }
  function valueNoise(x,y,seed,scale){
    const gx=x/scale, gy=y/scale;
    const x0=Math.floor(gx), y0=Math.floor(gy);
    const x1=x0+1, y1=y0+1;
    const sx=smooth01(gx-x0), sy=smooth01(gy-y0);
    const n00=hash(x0,y0,seed), n10=hash(x1,y0,seed);
    const n01=hash(x0,y1,seed), n11=hash(x1,y1,seed);
    const ix0=n00+(n10-n00)*sx, ix1=n01+(n11-n01)*sx;
    return ix0+(ix1-ix0)*sy;
  }

  function generate(generatorId, seed) {
    if (!TERRAIN) throw new Error("terrain.json non chargé");
    const gen = TERRAIN.generators[generatorId];
    if (!gen) throw new Error("Générateur inconnu: " + generatorId);
    const { w, h } = gen.size;
    const weights = gen.weights;
    const ids = Object.keys(weights);
    const total = ids.reduce((s,k)=>s+weights[k],0);
    const rnd = makeRng(seed || 12345);
    const S = seed || 12345;

    // --- 1) Terrain de fond : herbe / terre (sable exclu, géré en transition) ---
    // On choisit les 1 ou 2 types "normaux" les plus représentés comme fond de
    // carte, mélangés via un bruit de valeur à basse fréquence pour obtenir de
    // grandes plaques organiques plutôt qu'un simple tirage pixel par pixel.
    const normalIds = ids
      .filter(id => id !== "sable" && TERRAIN.types[id] && TERRAIN.types[id].category === "normal")
      .sort((a,b)=>weights[b]-weights[a]);
    const baseA = normalIds[0] || ids[0];
    const baseB = normalIds[1] || baseA;
    const baseScale = Math.max(6, Math.round(Math.sqrt(w*h)/4));
    const wA = weights[baseA]||1, wB = weights[baseB]||1;
    const baseThreshold = wA/(wA+wB); // proportion visée de baseA

    const grid = [];
    for(let y=0;y<h;y++){
      const row=[];
      for(let x=0;x<w;x++){
        const n = valueNoise(x,y,S+901,baseScale);
        row.push(n < baseThreshold ? baseA : baseB);
      }
      grid.push(row);
    }

    // --- 2) Zones ovales bruitées (eau, bois, ruines, colines, etc.) ---
    // Chaque type restant du générateur est semé sous forme d'un petit nombre
    // d'ellipses de taille variable. Le contour de chaque ellipse est perturbé
    // par un bruit de valeur à petite échelle : la limite entre deux terrains
    // n'est donc jamais une ligne droite/géométrique.
    const zoneIds = ids.filter(id => id!==baseA && id!==baseB && id!=="sable");
    const areaScale = Math.sqrt(w*h)/48; // 1 pour une carte 48x48 de référence
    let zoneSeed = S;
    for(const id of zoneIds){
      const weight = weights[id];
      const count = Math.max(1, Math.round(weight/2 * areaScale));
      for(let i=0;i<count;i++){
        zoneSeed = (zoneSeed*2654435761 + 1) >>> 0;
        const localRnd = makeRng(zoneSeed);
        const cx = localRnd()*w, cy = localRnd()*h;
        const baseR = (3 + localRnd()*5) * areaScale;
        const rx = baseR * (0.7 + localRnd()*0.6);
        const ry = baseR * (0.5 + localRnd()*0.5) * 0.55; // aplati pour l'iso
        const angle = localRnd()*Math.PI;
        const cos=Math.cos(angle), sin=Math.sin(angle);
        const noiseAmp = 0.4;
        const noiseScale = Math.max(3, baseR*0.5);
        const noiseSeed = zoneSeed ^ 0x9e3779b9;

        const minX=Math.max(0,Math.floor(cx-rx-noiseScale*2));
        const maxX=Math.min(w-1,Math.ceil(cx+rx+noiseScale*2));
        const minY=Math.max(0,Math.floor(cy-ry-noiseScale*2));
        const maxY=Math.min(h-1,Math.ceil(cy+ry+noiseScale*2));

        for(let y=minY;y<=maxY;y++){
          for(let x=minX;x<=maxX;x++){
            const dx=x-cx, dy=y-cy;
            const rdx = dx*cos+dy*sin, rdy = -dx*sin+dy*cos;
            const dist = Math.sqrt((rdx*rdx)/(rx*rx) + (rdy*rdy)/(ry*ry));
            const edgeNoise = (valueNoise(x,y,noiseSeed,noiseScale)-0.5)*2*noiseAmp;
            if(dist + edgeNoise < 1){
              grid[y][x] = id;
            }
          }
        }
      }
    }

    // Lissage léger : élimine les pixels isolés issus du bruit sans effacer
    // la forme générale des zones (biomes lisibles, bords toujours irréguliers).
    for(let pass=0;pass<1;pass++){
      const next=grid.map(r=>r.slice());
      for(let y=1;y<h-1;y++){
        for(let x=1;x<w-1;x++){
          const here=grid[y][x];
          const counts={};
          for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
            if(dx===0&&dy===0) continue;
            const id=grid[y+dy][x+dx];
            counts[id]=(counts[id]||0)+1;
          }
          let best=here,bestN=0;
          for(const id of Object.keys(counts)){
            if(counts[id]>bestN){bestN=counts[id];best=id;}
          }
          if(bestN>=6 && TERRAIN.types[best]) next[y][x]=best;
        }
      }
      for(let y=0;y<h;y++) for(let x=0;x<w;x++) grid[y][x]=next[y][x];
    }

    // Cohérence des obstacles : ne crée pas de murs/rochers isolés.
    for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++){
      const t=TERRAIN.types[grid[y][x]];
      let imp=0;
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const n=TERRAIN.types[grid[y+dy][x+dx]];
        if(n&&n.blocks) imp++;
      }
      if(imp>=3 && t && !t.blocks && weights.rochers) grid[y][x]="rochers";
    }

    // Ajoute des bandes de terrain naturel : plages, chemins de terre et débris.
    for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++){
      const id=grid[y][x], t=TERRAIN.types[id];
      if(!t) continue;
      const nearWater=[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>{
        const n=grid[y+dy][x+dx]; return n==="eau"||n==="profonde";
      });
      if(nearWater && id==="herbe" && hash(x,y,seed||1)>.62 && TERRAIN.types.sable) grid[y][x]="sable";
      if(id==="terre" && hash(x,y,(seed||1)+17)>.86 && TERRAIN.types.decombres) grid[y][x]="decombres";
    }

    return grid;
  }

  function draw(ctx, grid, camX, camY, viewW, viewH, sprites) {
    if(!TERRAIN || !grid || !grid[0]) return;
    const tileW=TERRAIN.tileW,tileH=TERRAIN.tileH;
    const h=grid.length,w=grid[0].length;

    for(let r=0;r<h;r++){
      for(let c=0;c<w;c++){
        const s=Movement.gridToScreen(c,r);
        const x=s.x+camX,y=s.y+camY;
        if(x<-tileW||x>viewW+tileW||y<-tileH||y>viewH+tileH) continue;
        const id=grid[r][c], t=TERRAIN.types[id];
        if(!t) continue;

        if(sprites && sprites.tile(id)){
          const img=sprites.tile(id);
          ctx.drawImage(img,x-tileW/2,y,tileW,tileH);
        }else{
          drawDiamond(ctx,x,y,tileW,tileH,t.color,t);
        }

        drawTerrainDetails(ctx,c,r,x,y,tileW,tileH,id);
      }
    }
  }

  function drawDiamond(ctx,cx,cy,tw,th,color,t){
    // Base tile.
    ctx.beginPath();
    ctx.moveTo(cx,cy); ctx.lineTo(cx+tw/2,cy+th/2);
    ctx.lineTo(cx,cy+th); ctx.lineTo(cx-tw/2,cy+th/2); ctx.closePath();
    ctx.fillStyle=color; ctx.fill();

    // Relief edge: gives elevation and terrain depth without changing gameplay coordinates.
    if((t.height||0)>0){
      const lift=Math.min(8,(t.height||0)*3);
      ctx.beginPath();
      ctx.moveTo(cx-tw/2,cy+th/2); ctx.lineTo(cx,cy+th);
      ctx.lineTo(cx+tw/2,cy+th/2);
      ctx.lineTo(cx,cy+th+lift);
      ctx.closePath();
      ctx.fillStyle="rgba(0,0,0,.12)"; ctx.fill();
    }

    ctx.strokeStyle="rgba(0,0,0,.25)";
    ctx.lineWidth=1; ctx.stroke();
  }

  function drawTerrainDetails(ctx,c,r,x,y,tw,th,id){
    const n=hash(c,r,7919);
    ctx.save();

    if(id==="herbe" && n>.60){
      ctx.strokeStyle="rgba(150,170,105,.20)";
      ctx.lineWidth=1;
      for(let i=0;i<3;i++){
        const ox=(hash(c+i,r+2,13)-.5)*tw*.65;
        const oy=th*.52+(hash(c+4,r+i,31)-.5)*th*.28;
        ctx.beginPath(); ctx.moveTo(x+ox,y+oy); ctx.lineTo(x+ox-2,y+oy-5); ctx.stroke();
      }
    } else if(id==="sable" && n>.58){
      ctx.fillStyle="rgba(220,190,120,.18)";
      for(let i=0;i<3;i++){
        const ox=(hash(c+i,r,21)-.5)*tw*.65, oy=th*.45+(hash(c,r+i,22)-.5)*th*.25;
        ctx.fillRect(x+ox,y+oy,2,1);
      }
    } else if(id==="bois" || id==="arbres"){
      ctx.fillStyle="rgba(0,0,0,.15)";
      ctx.beginPath(); ctx.arc(x-8,y+th*.48,4,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(x+8,y+th*.48,5,0,Math.PI*2); ctx.fill();
    } else if(id==="eau" || id==="profonde"){
      ctx.strokeStyle="rgba(150,200,220,.16)";
      ctx.lineWidth=1;
      const yy=y+th*.55;
      ctx.beginPath(); ctx.moveTo(x-tw*.22,yy); ctx.quadraticCurveTo(x,yy-2,x+tw*.22,yy); ctx.stroke();
    }
    ctx.restore();
  }

  function getGameplay(id){
    const t=TERRAIN?.types?.[id];
    return t ? {
      move:t.move ?? 1,
      blocks:!!t.blocks,
      blocksView:!!t.blocksView,
      damage:t.damage ?? 0,
      height:t.height ?? 0,
      cover:t.cover ?? 0
    } : null;
  }

  window.Terrain={load,get,generate,draw,getGameplay};
})();

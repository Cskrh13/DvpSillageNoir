/* DvpSillageNoir — IA tactique partagée V8
   Même moteur pour index.html et test-combat.html.
*/
(function(){
"use strict";
const AI={version:"8.0"};

AI.alive=u=>!!u && Number(u.hp??1)>0;
AI.dist=(a,b)=>Math.hypot(Number(a.col)-Number(b.col),Number(a.row)-Number(b.row));
AI.side=u=>u.side??u.team??u.camp;
AI.isRanged=u=>Number(u.atkRange||u.range||0)>0;
AI.role=u=>{
  if(u.role) return String(u.role).toLowerCase();
  if(AI.isRanged(u)) return "tireur";
  const cat=String(u.category||u.type||"").toLowerCase();
  if(cat.includes("caval")) return "cavalerie";
  return "ligne";
};

AI.ensure=function(u){
  u._ai=u._ai||{
    enabled:true, target:null, state:"advance", nextThink:0,
    manualUntil:0, formationUntil:0, morale:8, facing:0
  };
  return u._ai;
};

AI.detect=function(u,enemies,grid,movement,range){
  if(!movement) return [];
  const r=range??(AI.isRanged(u)?340:260);
  return (enemies||[]).filter(AI.alive).filter(e=>{
    if(AI.dist(u,e)>r) return false;
    try{
      return movement.lineOfSight(
        grid?.types||grid?.terrain||grid?.tileTypes||[],
        grid?.cells||grid||[],
        {col:Number(u.col),row:Number(u.row)},
        {col:Number(e.col),row:Number(e.row)}
      );
    }catch(_){ return true; }
  });
};

AI.choose=function(u,visible){
  if(!visible.length)return null;
  const s=u.targetStrategy||u.strategy||"closest";
  if(s==="lowest_hp") return [...visible].sort((a,b)=>a.hp-b.hp)[0];
  if(s==="highest_chance" && window.Interactions?.estimateAttackSuccess)
    return [...visible].sort((a,b)=>window.Interactions.estimateAttackSuccess(u,b)-window.Interactions.estimateAttackSuccess(u,a))[0];
  return [...visible].sort((a,b)=>AI.dist(u,a)-AI.dist(u,b))[0];
};

AI.path=function(u,g,grid,movement,types){
  if(!movement?.findPath||!g)return false;
  try{
    const p=movement.findPath(types,grid,{col:+u.col,row:+u.row},g);
    if(p&&p.length>1){u._path=p.slice(1);u._order="move";return true;}
  }catch(_){}
  return false;
};

AI.tick=function(u,ctx,now){
  if(!AI.alive(u)||!ctx)return;
  const a=AI.ensure(u);
  if(!a.enabled)return;
  if(now<a.manualUntil || now<a.formationUntil || now<a.nextThink)return;
  a.nextThink=now+(ctx.thinkMs||300);

  const enemies=(ctx.enemies||[]).filter(e=>AI.alive(e)&&AI.side(e)!==AI.side(u));
  if(!enemies.length){u._order="stop";return;}

  const visible=AI.detect(u,enemies,ctx.grid,ctx.movement);
  let target=AI.choose(u,visible);
  if(target)a.target=target;
  else if(AI.alive(a.target))target=a.target;

  const ranged=AI.isRanged(u), attackRange=ranged?Number(u.atkRange||220):48;

  if(target){
    a.facing=Math.atan2(Number(target.row)-Number(u.row),Number(target.col)-Number(u.col));
    u._facing=a.facing;

    const distance=AI.dist(u,target);
    if(distance<=attackRange){
      u._target=target;
      u._order="attack";
      u._path=[];
      return;
    }

    // Approche : les tireurs s'arrêtent à distance, la ligne charge jusqu'au contact.
    const desired=ranged?Math.min(attackRange,7*28):1;
    const dx=Number(target.col)-Number(u.col),dy=Number(target.row)-Number(u.row);
    const len=Math.hypot(dx,dy)||1;
    const goal={
      col:Math.round(Number(target.col)-dx/len*desired),
      row:Math.round(Number(target.row)-dy/len*desired)
    };
    u._target=target;
    if(AI.path(u,goal,ctx.grid,ctx.movement,ctx.types)) {
      u._order=ranged?"move":"charge";
      return;
    }
  }

  // Progression autonome : aucune unité ne reste inactive faute de cible visible.
  const front=enemies.slice().sort((a,b)=>AI.dist(u,a)-AI.dist(u,b))[0];
  const dx=Number(front.col)-Number(u.col),dy=Number(front.row)-Number(u.row);
  const len=Math.hypot(dx,dy)||1;
  const step=AI.role(u)==="tireur"?2:4;
  AI.path(u,{
    col:Math.round(Number(u.col)+dx/len*step),
    row:Math.round(Number(u.row)+dy/len*step)
  },ctx.grid,ctx.movement,ctx.types);
};

AI.order=function(u,order,until=1500){
  const a=AI.ensure(u);
  a.manualUntil=performance.now()+until;
  if(order?.target)a.target=order.target;
  if(order?.path)u._path=order.path.slice();
  if(order?.state)u._order=order.state;
};

window.DvpOldWorldAI=AI;
})();
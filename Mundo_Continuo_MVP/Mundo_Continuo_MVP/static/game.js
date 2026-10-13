(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const canvas = $("game"), ctx = canvas.getContext("2d");
  const mini = $("minimap"), mtx = mini.getContext("2d");
  const joinScreen = $("joinScreen"), form = $("joinForm");
  const viewport = {w:960,h:570,dpr:1};
  const maps = new WorldMaps();
  const world = {width:4200,height:1120};
  const camera = {x:0,y:0};
  const keys = new Set();
  const pointer = {x:400,y:300,worldX:400,worldY:300};
  let socket=null, myId=null, currentName="Explorador", joined=false;
  let state = {players:[],monsters:[],events:[]};
  let walkTarget=null, walkRoute=[], effects=[];
  let currentZone=null, firstState=true, lastStreamCheck=0;
  let myRender={x:295,y:580};
  const rendered = new Map();
  const cd = {basic:0,power:0};

  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const dist=(a,b,c,d)=>Math.hypot(a-c,b-d);
  const lerp=(a,b,t)=>a+(b-a)*t;
  const me=()=>state.players.find(p=>p.id===myId);
  function resize(){
    const bounds=canvas.getBoundingClientRect();
    viewport.w=bounds.width;viewport.h=bounds.height;
    viewport.dpr=Math.min(devicePixelRatio||1,2);
    canvas.width=Math.round(bounds.width*viewport.dpr);
    canvas.height=Math.round(bounds.height*viewport.dpr);
  }
  new ResizeObserver(resize).observe(canvas);resize();
  try{$("nameInput").value=localStorage.getItem("umbral_name")||"Explorador";}catch{}
  function send(obj){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(obj));}
  function netStatus(isOn){$("networkState").classList.toggle("disconnected",!isOn);$("networkState").innerHTML=`<i></i> ${isOn?"CONECTADO":"DESCONECTADO"}`;}
  function feed(message){
    const el=document.createElement("div");el.className="feed-line";el.textContent=message;
    $("feed").appendChild(el);
    while($("feed").children.length>3)$("feed").firstChild.remove();
    setTimeout(()=>el.remove(),4100);
  }
  function connect(name){
    if(socket?.readyState===WebSocket.OPEN)return;
    currentName=name;
    const proto=location.protocol==="https:"?"wss:":"ws:";
    $("errorText").textContent="";$("joinButton").disabled=true;$("joinButton").textContent="CONECTANDO…";
    socket=new WebSocket(`${proto}//${location.host}/ws`);
    socket.onopen=()=>{send({type:"join",name});netStatus(true);};
    socket.onmessage=e=>{
      let message;try{message=JSON.parse(e.data);}catch{return;}
      if(message.type==="welcome"){
        joined=true;myId=message.id;joinScreen.classList.add("hidden");
        maps.setManifest(message.manifest);
        world.width=maps.manifest.width;world.height=maps.manifest.height;
        firstState=true;currentZone=null;rendered.clear();effects=[];walkRoute=[];walkTarget=null;
        $("canvasWrap").dataset.playerId=myId;
        $("joinButton").disabled=false;$("joinButton").innerHTML='ENTRAR AL MUNDO <span>↗</span>';
        $("playerName").textContent=currentName.toUpperCase();
        try{localStorage.setItem("umbral_name",currentName);}catch{}
        feed("Has entrado al mundo continuo");
      }else if(message.type==="state"){
        state=message;
        const p=me();
        if(p){cd.basic=performance.now()+p.basicRemaining*1000;cd.power=performance.now()+p.powerRemaining*1000;}
        const zone=state.map || (p && maps.zoneAt(p));
        $("onlineCount").textContent=`${state.world?.online ?? state.players.length} EN LÍNEA`;
        $("playersStat").textContent=String(state.zoneCounts?.[zone?.id] ?? state.players.length).padStart(2,"0");
        $("nearbyStat").textContent=String(state.players.length).padStart(2,"0");
        $("mobsStat").textContent=String(state.monsters.filter(m=>!m.dead).length).padStart(2,"0");
        if(p){
          if(firstState){myRender={x:p.x,y:p.y};firstState=false;}
          const data=$("canvasWrap").dataset;
          data.zoneId=p.zoneId||zone?.id||"forest";data.x=String(p.x);data.y=String(p.y);
          data.hp=String(p.hp);data.kills=String(p.kills);data.nearbyPlayers=String(state.players.length);
          data.playerIds=state.players.map(other=>other.id).sort().join(",");
          data.online=String(state.world?.online ?? state.players.length);
          data.basicRemaining=String(p.basicRemaining);data.powerRemaining=String(p.powerRemaining);
          if(zone && currentZone!==zone.id){
            currentZone=zone.id;
            $("zoneName").textContent=zone.name.toUpperCase();
            $("areaName").textContent=zone.name.toUpperCase();
            $("zoneNumber").textContent=zone.id==="corridor"?"CONEXIÓN":`ZONA ${String(zone.index||1).padStart(2,"0")}`;
            $("mapStat").textContent=zone.id==="corridor"?"PASO":`${String(zone.index||1).padStart(2,"0")} / 02`;
            $("regionStat").textContent=zone.id==="ruins"?"RUINAS":zone.id==="forest"?"BOSQUE":"DESFILADERO";
            $("travelHint").textContent=zone.id==="forest"?"Sigue el sendero al este → Ruinas":zone.id==="ruins"?"← Bosque · Explora las ruinas":"← Bosque · Paso de las Raíces · Ruinas →";
            feed(zone.name);
          }
          $("killsStat").textContent=String(p.kills).padStart(2,"0");
          $("hpFill").style.width=`${Math.round(p.hp/p.maxHp*100)}%`;
          $("hpText").textContent=`${p.hp} / ${p.maxHp} HP`;
          $("deathBanner").classList.toggle("hidden",!p.dead);
        }
        const activeIds=new Set([...state.players,...state.monsters].map(entity=>entity.id));
        for(const id of rendered.keys())if(!activeIds.has(id))rendered.delete(id);
        for(const ev of message.events||[]){
          effects.push({...ev,born:performance.now()});
          if(ev.kind==="join"&&ev.name!==currentName)feed(`${ev.name} ha llegado al mundo`);
          if(ev.kind==="leave")feed(`${ev.name} salió del mundo`);
        }
      }else if(message.type==="error"){$("errorText").textContent=message.message;}
    };
    socket.onerror=()=>{$("errorText").textContent="No se puede conectar al servidor.";};
    socket.onclose=()=>{
      joined=false;myId=null;netStatus(false);walkTarget=null;walkRoute=[];keys.clear();
      $("joinButton").disabled=false;$("joinButton").innerHTML='VOLVER A ENTRAR <span>↗</span>';
      $("errorText").textContent="La conexión terminó. Puedes volver a entrar.";
      joinScreen.classList.remove("hidden");
    };
  }
  form.addEventListener("submit",e=>{e.preventDefault();connect($("nameInput").value.trim().slice(0,18)||"Explorador");});
  function coordsFromMouse(e){
    const box=canvas.getBoundingClientRect();
    pointer.x=e.clientX-box.left;pointer.y=e.clientY-box.top;
    pointer.worldX=pointer.x+camera.x;pointer.worldY=pointer.y+camera.y;
  }
  canvas.addEventListener("mousemove",coordsFromMouse);
  canvas.addEventListener("contextmenu",e=>e.preventDefault());
  canvas.addEventListener("mousedown",e=>{
    if(!joined)return;
    e.preventDefault();coordsFromMouse(e);
    if(e.button===0){send({type:"basic"});}
    if(e.button===2){
      const target={x:pointer.worldX,y:pointer.worldY},p=me();
      walkRoute=[];
      if(!p||!maps.zoneAt(target))return;
      const from=maps.zoneAt(p),to=maps.zoneAt(target);
      if(from?.id!==to?.id){
        const east=target.x>p.x;
        if(from?.id!=="corridor")walkRoute.push({x:east?1755:2445,y:560});
        if(to?.id!=="corridor")walkRoute.push({x:east?2445:1755,y:560});
      }
      walkRoute.push(target);walkTarget=walkRoute.shift();
    }
  });
  window.addEventListener("keydown",e=>{
    if(e.target instanceof HTMLInputElement)return;
    const k=e.key.toLowerCase();
    if([" ","arrowup","arrowdown","arrowleft","arrowright","q"].includes(k))e.preventDefault();
    keys.add(k);
    if(!joined||e.repeat)return;
    if(k==="q")send({type:"power",x:pointer.worldX,y:pointer.worldY});
    if(k===" ")send({type:"basic"});
    if("wasd".includes(k)&&k.length===1){walkTarget=null;walkRoute=[];}
  });
  window.addEventListener("keyup",e=>keys.delete(e.key.toLowerCase()));
  window.addEventListener("blur",()=>keys.clear());
  setInterval(()=>{
    if(!joined)return;
    const p=me();if(!p)return;
    let mx=(keys.has("d")?1:0)-(keys.has("a")?1:0);
    let my=(keys.has("s")?1:0)-(keys.has("w")?1:0);
    if(!mx&&!my&&walkTarget){
      let dx=walkTarget.x-p.x,dy=walkTarget.y-p.y,dd=Math.hypot(dx,dy);
      if(dd>13){mx=dx/dd;my=dy/dd;}else walkTarget=walkRoute.shift()||null;
    }
    send({type:"input",mx,my,aimX:pointer.worldX,aimY:pointer.worldY});
  },50);

  function visible(x,y,r=60){return x+r>camera.x&&x-r<camera.x+viewport.w&&y+r>camera.y&&y-r<camera.y+viewport.h;}
  function roundRect(x,y,w,h,r,fill,stroke){
    ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1.5;ctx.stroke();}
  }
  function healthbar(x,y,hp,max,width=50){
    ctx.fillStyle="#1e252d";ctx.fillRect(x-width/2,y,width,6);
    ctx.fillStyle=hp/max>.5?"#92ca93":hp/max>.25?"#e4b46e":"#e77c78";
    ctx.fillRect(x-width/2+1,y+1,Math.max(0,(width-2)*hp/max),4);
  }
  function entityPosition(entity){
    let r=rendered.get(entity.id);if(!r){r={x:entity.x,y:entity.y};rendered.set(entity.id,r);}
    // Snap to authoritative position if significantly out of sync.
    if(dist(r.x,r.y,entity.x,entity.y)>250){r.x=entity.x;r.y=entity.y;}
    const t=entity.id===myId ? 0.34 : 0.22;
    r.x=lerp(r.x,entity.x,t);r.y=lerp(r.y,entity.y,t);
    return r;
  }
  function drawMonster(m,now){
    if(m.dead)return;
    const pos=entityPosition(m),x=pos.x,y=pos.y;
    if(!visible(x,y,m.detection+30))return;
    const player=me();
    const inRange=player&&!player.dead&&dist(player.x,player.y,m.x,m.y)<=m.detection;
    if(inRange){
      ctx.beginPath();ctx.arc(x,y,m.detection,0,7);ctx.fillStyle="#e0a16c0e";ctx.fill();ctx.strokeStyle="#edb16d55";ctx.lineWidth=1.5;ctx.setLineDash([7,9]);ctx.stroke();ctx.setLineDash([]);
    }
    const bob=Math.sin(now*.004+x)*2;
    ctx.beginPath();ctx.ellipse(x,y+14,18,7,0,0,7);ctx.fillStyle="#0e1f2388";ctx.fill();
    if(m.kind==="slime"){
      ctx.beginPath();ctx.ellipse(x,y-2+bob,18,15,0,Math.PI,Math.PI*2);ctx.lineTo(x+18,y+10+bob);ctx.quadraticCurveTo(x,y+19+bob,x-18,y+10+bob);ctx.closePath();ctx.fillStyle="#c6a56b";ctx.fill();ctx.strokeStyle="#ffe0a0";ctx.lineWidth=1.8;ctx.stroke();
      ctx.fillStyle="#423c36";ctx.fillRect(x-6,y-1+bob,3,4);ctx.fillRect(x+4,y-1+bob,3,4);
    }else if(m.kind==="sentinel"){
      ctx.save();ctx.translate(x,y+bob);
      ctx.fillStyle="#746582";ctx.strokeStyle="#dcc18c";ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(0,-29);ctx.lineTo(23,-9);ctx.lineTo(18,18);ctx.lineTo(-18,18);ctx.lineTo(-23,-9);ctx.closePath();ctx.fill();ctx.stroke();
      ctx.fillStyle="#dab771";ctx.fillRect(-20,-8,40,7);ctx.fillStyle="#f8ead0";ctx.fillRect(-4,-6,8,5);
      ctx.strokeStyle="#baa0d2";ctx.beginPath();ctx.moveTo(-27,-19);ctx.lineTo(-27,22);ctx.stroke();ctx.restore();
    }else if(m.kind==="shade"){
      ctx.save();ctx.translate(x,y+bob);ctx.shadowBlur=14;ctx.shadowColor="#b7a0f2";
      ctx.fillStyle="#746b9bcc";ctx.strokeStyle="#c5b6ef";ctx.lineWidth=1.5;
      ctx.beginPath();ctx.moveTo(0,-24);ctx.quadraticCurveTo(23,-14,15,7);ctx.lineTo(19,23);ctx.lineTo(2,16);ctx.lineTo(-17,24);ctx.lineTo(-12,5);ctx.quadraticCurveTo(-22,-16,0,-24);ctx.fill();ctx.stroke();
      ctx.shadowBlur=0;ctx.fillStyle="#f2e1b5";ctx.fillRect(-7,-9,4,3);ctx.fillRect(4,-9,4,3);ctx.restore();
    }else if(m.kind==="wisp"){
      ctx.shadowBlur=19;ctx.shadowColor="#db91dc";ctx.fillStyle="#a277a9";ctx.beginPath();ctx.arc(x,y-5+bob,14,0,7);ctx.fill();ctx.shadowBlur=0;
      ctx.fillStyle="#f1d2ff";ctx.fillRect(x-5,y-8+bob,4,3);ctx.fillRect(x+3,y-8+bob,4,3);
      ctx.fillStyle="#c79dcb";ctx.beginPath();ctx.moveTo(x-8,y+8+bob);ctx.lineTo(x,y+20+bob);ctx.lineTo(x+7,y+7+bob);ctx.fill();
    }else{
      roundRect(x-19,y-22+bob,38,37,5,"#9c7359","#d2ab78");
      ctx.fillStyle="#e9c17a";ctx.fillRect(x-9,y-9+bob,5,4);ctx.fillRect(x+5,y-9+bob,5,4);
      ctx.fillStyle="#6f5648";ctx.fillRect(x-14,y+9+bob,11,10);ctx.fillRect(x+4,y+9+bob,11,10);
    }
    healthbar(x,y-37,m.hp,m.maxHp,["golem","sentinel"].includes(m.kind)?53:42);
    if(inRange){ctx.fillStyle="#ffd7a0";ctx.font="700 9px system-ui";ctx.textAlign="center";ctx.fillText("¡ALERTA!",x,y-48);}
  }
  function drawPlayer(p,now){
    const v=entityPosition(p),x=v.x,y=v.y,isMe=p.id===myId;
    if(!visible(x,y,50))return;
    const r=p.dead?.35:1;
    ctx.save();ctx.globalAlpha=r;
    ctx.beginPath();ctx.ellipse(x,y+15,17,6,0,0,7);ctx.fillStyle="#0e1e2888";ctx.fill();
    if(isMe){ctx.beginPath();ctx.arc(x,y,26,0,7);ctx.strokeStyle="#bae5a1";ctx.lineWidth=1.6;ctx.setLineDash([4,6]);ctx.stroke();ctx.setLineDash([]);}
    const face=Math.atan2(p.dy,p.dx);
    ctx.save();ctx.translate(x,y);ctx.rotate(face+Math.PI/2);
    // Provisional top-down square character; no art asset dependency.
    roundRect(-15,-14,30,30,5,isMe?"#4daab8":"#6c8fa9",isMe?"#d3f8e6":"#cadceb");
    ctx.fillStyle="#b2e7e4";ctx.fillRect(-10,-10,20,7);
    ctx.fillStyle="#174351";ctx.fillRect(-8,-7,16,9);
    ctx.fillStyle="#f0e7c9";ctx.fillRect(-6,4,12,3);
    ctx.fillStyle="#e8e8d8";ctx.fillRect(16,-7,4,24);
    ctx.fillStyle="#e7c487";ctx.fillRect(13,10,11,4);
    ctx.restore();ctx.restore();
    if(isMe){
      ctx.beginPath();ctx.moveTo(x+Math.cos(face)*24,y+Math.sin(face)*24);ctx.lineTo(x+Math.cos(face-.2)*32,y+Math.sin(face-.2)*32);ctx.lineTo(x+Math.cos(face+.2)*32,y+Math.sin(face+.2)*32);ctx.closePath();ctx.fillStyle="#d0e8a5";ctx.fill();
    }
    ctx.font="700 11px system-ui";ctx.textAlign="center";ctx.fillStyle=isMe?"#ecffd9":"#f1f6f2";ctx.fillText(p.name,x,y-35);
    healthbar(x,y-29,p.hp,p.maxHp,54);
  }
  function drawEffects(now){
    effects=effects.filter(ev=>now-ev.born<(ev.kind==="nova"?740:ev.kind==="join"||ev.kind==="respawn"?1050:850));
    for(const e of effects){
      const age=now-e.born,alpha=1-clamp(age/800,0,1);
      ctx.save();ctx.globalAlpha=alpha;
      if(e.kind==="nova"){
        const r=18+e.radius*clamp(age/350,0,1);
        ctx.beginPath();ctx.arc(e.x,e.y,r,0,7);ctx.strokeStyle="#c9a2fc";ctx.lineWidth=6*(1-age/800)+1;ctx.stroke();
        ctx.beginPath();ctx.arc(e.x,e.y,r*.63,0,7);ctx.strokeStyle="#f7d5ff";ctx.lineWidth=2;ctx.stroke();
      }else if(e.kind==="slash"){
        const angle=Math.atan2(e.dy,e.dx);ctx.beginPath();ctx.arc(e.x,e.y,84,angle-0.78,angle+0.78);ctx.strokeStyle="#d8f6de";ctx.lineWidth=7;ctx.stroke();ctx.beginPath();ctx.arc(e.x,e.y,71,angle-.78,angle+.78);ctx.strokeStyle="#e5ae68";ctx.lineWidth=3;ctx.stroke();
      }else if(e.kind==="damage"||e.kind==="hurt"){
        ctx.font="900 17px system-ui";ctx.textAlign="center";ctx.fillStyle=e.kind==="hurt"?"#ffb3a7":"#ffe7a9";ctx.strokeStyle="#15242b";ctx.lineWidth=3;
        ctx.strokeText(`−${e.amount}`,e.x,e.y-age*.055);ctx.fillText(`−${e.amount}`,e.x,e.y-age*.055);
      }else if(e.kind==="monster_attack"){
        ctx.beginPath();ctx.moveTo(e.x,e.y);ctx.lineTo(e.tx,e.ty);ctx.strokeStyle="#f29674";ctx.lineWidth=4;ctx.stroke();
      }else if(e.kind==="death"){
        ctx.beginPath();ctx.arc(e.x,e.y,20+age*.065,0,7);ctx.strokeStyle="#e3977a";ctx.lineWidth=2;ctx.stroke();
      }else if(e.kind==="join"||e.kind==="respawn"){
        ctx.beginPath();ctx.arc(e.x,e.y,15+age*.08,0,7);ctx.strokeStyle="#a2e5cb";ctx.lineWidth=2;ctx.stroke();
      }
      ctx.restore();
    }
  }
  function drawPointer(){
    if(!joined)return;
    ctx.save();ctx.translate(pointer.worldX,pointer.worldY);ctx.strokeStyle="#e8ead2aa";ctx.lineWidth=1.4;
    ctx.beginPath();ctx.arc(0,0,12,0,7);ctx.moveTo(-20,0);ctx.lineTo(-8,0);ctx.moveTo(8,0);ctx.lineTo(20,0);ctx.moveTo(0,-20);ctx.lineTo(0,-8);ctx.moveTo(0,8);ctx.lineTo(0,20);ctx.stroke();ctx.restore();
    if(walkTarget){ctx.beginPath();ctx.arc(walkTarget.x,walkTarget.y,13,0,7);ctx.strokeStyle="#b3e2a5";ctx.lineWidth=2;ctx.stroke();}
  }
  function drawMini(){
    const w=mini.width,h=mini.height,padding=12;
    const scale=(w-padding*2)/world.width, oy=(h-world.height*scale)/2;
    const px=x=>padding+x*scale,py=y=>oy+y*scale;
    mtx.clearRect(0,0,w,h);mtx.fillStyle="#0c1a22";mtx.fillRect(0,0,w,h);
    for(const zone of maps.manifest.zones){
      const b=zone.bounds;
      mtx.fillStyle=zone.id==="forest"?"#2a5343":zone.id==="ruins"?"#4e405b":"#506164";
      mtx.fillRect(px(b.x),py(b.y),b.width*scale,b.height*scale);
      mtx.strokeStyle=currentZone===zone.id?"#d3e4ac":"#7e9b8644";mtx.lineWidth=currentZone===zone.id?2:1;
      mtx.strokeRect(px(b.x),py(b.y),b.width*scale,b.height*scale);
      if(zone.id!=="corridor"){
        mtx.fillStyle="#b7c8b9";mtx.textAlign="center";mtx.font="700 9px system-ui";
        mtx.fillText(zone.id==="forest"?"BOSQUE":"RUINAS",px(b.x+b.width/2),oy-10);
        const count=state.zoneCounts?.[zone.id]||0;
        mtx.fillStyle="#91aa9e";mtx.font="9px system-ui";mtx.fillText(`${count} explorador${count===1?"":"es"}`,px(b.x+b.width/2),py(world.height)+19);
      }
    }
    mtx.strokeStyle="#a5b39555";mtx.lineWidth=2;mtx.beginPath();mtx.moveTo(px(295),py(560));mtx.lineTo(px(3900),py(560));mtx.stroke();
    for(const m of state.monsters){if(m.dead)continue;mtx.fillStyle="#eba769";mtx.fillRect(px(m.x)-1.5,py(m.y)-1.5,3,3);}
    for(const p of state.players){if(p.dead)continue;const mine=p.id===myId;mtx.fillStyle=mine?"#d3f3af":"#71d6fa";mtx.beginPath();mtx.arc(px(p.x),py(p.y),mine?4:2.5,0,7);mtx.fill();}
    mtx.strokeStyle="#def7e299";mtx.lineWidth=1;mtx.strokeRect(px(camera.x),py(camera.y),Math.min(viewport.w,world.width)*scale,Math.min(viewport.h,world.height)*scale);
    mtx.fillStyle="#78918c";mtx.textAlign="center";mtx.font="8px system-ui";mtx.fillText("UN SOLO MUNDO · PASO DE LAS RAÍCES",w/2,h-10);
  }
  function render(now){
    const p=me();
    if(p){
      if(!isFinite(myRender.x))myRender={x:p.x,y:p.y};
      myRender.x=lerp(myRender.x,p.x,.16);myRender.y=lerp(myRender.y,p.y,.16);
      camera.x=clamp(myRender.x-viewport.w*.49,0,Math.max(0,world.width-viewport.w));
      camera.y=clamp(myRender.y-viewport.h*.49,0,Math.max(0,world.height-viewport.h));
      $("posReadout").textContent=`X ${String(Math.round(p.x)).padStart(4,"0")} · Y ${String(Math.round(p.y)).padStart(4,"0")}`;
    }else{camera.x=0;camera.y=275;}
    pointer.worldX=pointer.x+camera.x;pointer.worldY=pointer.y+camera.y;
    ctx.setTransform(viewport.dpr,0,0,viewport.dpr,0,0);ctx.clearRect(0,0,viewport.w,viewport.h);
    ctx.save();ctx.translate(-camera.x,-camera.y);
    if(now-lastStreamCheck>150){maps.update(p||{x:295,y:580},camera,viewport);lastStreamCheck=now;}
    maps.draw(ctx,camera,viewport,now);
    for(const m of state.monsters)drawMonster(m,now);
    for(const person of state.players)drawPlayer(person,now);
    drawEffects(now);drawPointer();ctx.restore();
    drawMini();
    const pp=Math.max(0,(cd.power-now)/1000),bb=Math.max(0,(cd.basic-now)/1000);
    $("powerOverlay").style.transform=`translateY(${Math.round(100*(1-Math.min(1,pp/3.4)))}%)`;
    $("basicOverlay").style.transform=`translateY(${Math.round(100*(1-Math.min(1,bb/.48)))}%)`;
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
})();

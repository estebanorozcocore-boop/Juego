(() => {
  "use strict";
  const CHUNK = 384, PREFETCH = 1100, RELEASE = 1400;
  const defaultZones = [
    {id:"forest",name:"Bosque del Umbral",kind:"forest",index:1,bounds:{x:0,y:0,width:1800,height:1120},spawn:{x:295,y:580},assetUrl:"/maps/forest.json"},
    {id:"corridor",name:"Paso de las Raíces",kind:"corridor",index:0,bounds:{x:1800,y:440,width:600,height:240},spawn:{x:2100,y:560},assetUrl:"/maps/corridor.json"},
    {id:"ruins",name:"Ruinas del Alba",kind:"ruins",index:2,bounds:{x:2400,y:0,width:1800,height:1120},spawn:{x:2520,y:560},assetUrl:"/maps/ruins.json"}
  ];
  const palettes = {
    forest:{ground:"#23443c",alternate:"#294e40",path:"#616850",accent:"#b8d4a0"},
    corridor:{ground:"#313c40",alternate:"#39484b",path:"#56605b",accent:"#a7cbc0"},
    ruins:{ground:"#302b41",alternate:"#3b344c",path:"#65575e",accent:"#d4b479"}
  };
  const intersects = (a,b) => a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
  const distance = (p,b) => Math.hypot(Math.max(b.x-p.x,0,p.x-b.x-b.width),Math.max(b.y-p.y,0,p.y-b.y-b.height));
  const idle = callback => window.requestIdleCallback ? requestIdleCallback(callback,{timeout:80}) : setTimeout(callback,0);
  const rng = seed => {let n=Number(seed)||71323;return () => ((n=Math.imul(1664525,n)+1013904223|0)>>>0)/4294967296;};

  class WorldMaps {
    constructor() {
      this.manifest={width:4200,height:1120,zones:defaultZones,connections:[{from:"forest",via:"corridor",to:"ruins"}]};
      this.resources=new Map();
      this.failures=new Map();
      this.evictions=0;
      this.lastStats="";
    }
    setManifest(manifest) {
      if(!manifest?.zones?.length)return;
      this.manifest=manifest;
    }
    zoneAt(p) {
      return [...this.manifest.zones].reverse().find(z=>p.x>=z.bounds.x && p.x<=z.bounds.x+z.bounds.width && p.y>=z.bounds.y && p.y<=z.bounds.y+z.bounds.height);
    }
    update(p,camera,viewport) {
      const view={x:camera.x,y:camera.y,width:viewport.w,height:viewport.h};
      for(const zone of this.manifest.zones) {
        const d=distance(p,zone.bounds), inView=intersects(zone.bounds,view);
        if(d<PREFETCH || inView) this.prepare(zone);
        const resource=this.resources.get(zone.id);
        if(resource && d>RELEASE && !inView) {
          resource.cancelled=true;
          resource.controller.abort();
          for(const chunk of resource.chunks) {chunk.canvas.width=0;chunk.canvas.height=0;}
          resource.chunks.length=0;
          resource.asset=null;
          this.resources.delete(zone.id);
          this.evictions++;
        }
      }
      this.publishStats();
    }
    prepare(zone) {
      if(this.resources.has(zone.id))return;
      const failed=this.failures.get(zone.id), now=performance.now();
      if(failed && now<failed.retryAt)return;
      const resource={id:zone.id,status:"fetching",chunks:[],asset:null,cancelled:false,controller:new AbortController()};
      this.resources.set(zone.id,resource);
      const timeout=setTimeout(()=>resource.controller.abort(),8000);
      fetch(zone.assetUrl,{signal:resource.controller.signal,cache:"force-cache"})
        .then(response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json();})
        .then(asset=>{
          if(resource.cancelled)return;
          if(asset.id!==zone.id || !asset.bounds || !Array.isArray(asset.obstacles))throw new Error("Mapa incompleto");
          resource.asset=asset;
          resource.status="building";
          this.failures.delete(zone.id);
          this.buildChunks(resource);
        })
        .catch(error=>{
          if(resource.cancelled)return;
          this.resources.delete(zone.id);
          const attempts=(failed?.attempts||0)+1;
          this.failures.set(zone.id,{attempts:attempts>=3?0:attempts,retryAt:performance.now()+(attempts>=3?30000:attempts*2000)});
          console.warn(`No se pudo preparar ${zone.id}; se reintentará.`,error.message);
        })
        .finally(()=>clearTimeout(timeout));
    }
    buildChunks(resource) {
      const asset=resource.asset, b=asset.bounds;
      const jobs=[];
      for(let y=b.y;y<b.y+b.height;y+=CHUNK)for(let x=b.x;x<b.x+b.width;x+=CHUNK)jobs.push({x,y,width:Math.min(CHUNK,b.x+b.width-x),height:Math.min(CHUNK,b.y+b.height-y)});
      // One small canvas per idle turn keeps movement and network processing responsive.
      const build=()=>{
        if(resource.cancelled)return;
        const tile=jobs.shift();
        if(!tile){resource.status="ready";this.publishStats();return;}
        const surface=document.createElement("canvas");surface.width=tile.width;surface.height=tile.height;
        const c=surface.getContext("2d");c.translate(-tile.x,-tile.y);
        this.paintGround(c,asset,tile);
        resource.chunks.push({...tile,canvas:surface});
        idle(build);
      };
      idle(build);
    }
    publishStats() {
      const entries=[...this.resources.values()];
      const ready=entries.filter(r=>r.status==="ready").map(r=>r.id).sort();
      const loading=entries.filter(r=>r.status!=="ready").map(r=>r.id).sort();
      const summary=[ready.join(","),loading.join(","),this.evictions].join("|");
      if(summary===this.lastStats)return;
      this.lastStats=summary;
      const el=document.getElementById("canvasWrap");
      el.dataset.loadedZones=ready.join(",");
      el.dataset.loadingZones=loading.join(",");
      el.dataset.pendingZones=loading.join(",");
      el.dataset.cachedZones=entries.map(r=>r.id).sort().join(",");
      el.dataset.evictions=String(this.evictions);
      el.dataset.resourceChunks=String(entries.reduce((n,r)=>n+r.chunks.length,0));
      document.getElementById("landscapeStatus").textContent=loading.length?"Preparando el camino…":`${ready.length} ${ready.length===1?"zona preparada":"zonas preparadas"}`;
    }
    paintGround(c,asset,tile) {
      const b=asset.bounds, kind=asset.kind||asset.id, palette={...palettes[kind],...asset.palette};
      c.fillStyle=palette.ground;c.fillRect(tile.x,tile.y,tile.width,tile.height);
      const tileSize=kind==="ruins"?64:80;
      for(let x=Math.floor(tile.x/tileSize)*tileSize;x<tile.x+tile.width;x+=tileSize)for(let y=Math.floor(tile.y/tileSize)*tileSize;y<tile.y+tile.height;y+=tileSize){
        const n=Math.abs(Math.sin(x*.13+y*.71+(Number(asset.seed)||1)));
        c.fillStyle=n>.66?palette.alternate:palette.ground;c.fillRect(x,y,tileSize,tileSize);
        if(kind==="ruins") {c.strokeStyle="#b9a6c71c";c.lineWidth=1;c.strokeRect(x+2,y+2,tileSize-4,tileSize-4);}
      }
      c.save();c.beginPath();c.rect(b.x,b.y,b.width,b.height);c.clip();
      c.lineCap="round";c.lineJoin="round";
      c.beginPath();c.moveTo(b.x,560);
      if(kind==="forest") {c.bezierCurveTo(360,520,620,620,970,545);c.bezierCurveTo(1270,505,1530,580,1800,560);}
      else c.lineTo(b.x+b.width,560);
      c.lineWidth=kind==="corridor"?110:88;c.strokeStyle=palette.path;c.stroke();
      c.lineWidth=2;c.strokeStyle=kind==="ruins"?"#bd9b6550":"#b4bd8540";c.setLineDash([5,23]);c.stroke();c.setLineDash([]);
      if(kind==="forest") {
        c.beginPath();c.moveTo(710,0);c.bezierCurveTo(780,250,640,320,760,550);c.bezierCurveTo(960,810,910,940,985,1120);c.lineWidth=42;c.strokeStyle="#526044";c.stroke();
      }
      const random=rng(asset.seed||71323), count=kind==="forest"?430:kind==="ruins"?220:65;
      for(let i=0;i<count;i++) {
        const x=b.x+20+random()*(b.width-40),y=b.y+20+random()*(b.height-40),size=2+random()*6,type=random();
        if(x<tile.x-12 || x>tile.x+tile.width+12 || y<tile.y-12 || y>tile.y+tile.height+12)continue;
        if(kind==="forest") {
          if(type<.6){c.strokeStyle="#57956680";c.lineWidth=1.5;c.beginPath();c.moveTo(x-3,y+3);c.lineTo(x-1,y-3);c.moveTo(x,y+3);c.lineTo(x+4,y-5);c.stroke();}
          else if(type<.8){c.fillStyle="#487452";c.beginPath();c.ellipse(x,y,size+2,size*.6,0,0,7);c.fill();}
          else {c.fillStyle=type>.94?"#d7cb98":"#8b9a84";c.fillRect(x,y,size*.6,size*.4);}
        } else {
          c.strokeStyle=kind==="ruins"?"#c1a97950":"#90aca13b";c.lineWidth=1;c.beginPath();c.moveTo(x,y);c.lineTo(x+size,y+size*.4);c.lineTo(x+size*.5,y+size);c.stroke();
        }
      }
      for(const d of asset.decorations||[]){
        if(!Number.isFinite(d.x)||!Number.isFinite(d.y))continue;
        if(d.x<tile.x-20||d.x>tile.x+tile.width+20||d.y<tile.y-20||d.y>tile.y+tile.height+20)continue;
        c.fillStyle=d.color||palette.accent;c.globalAlpha=.5;c.beginPath();c.arc(d.x,d.y,d.radius||3,0,Math.PI*2);c.fill();c.globalAlpha=1;
      }
      c.restore();
    }
    draw(c,camera,viewport,now) {
      const view={x:camera.x,y:camera.y,width:viewport.w,height:viewport.h};
      c.fillStyle="#0d171e";c.fillRect(view.x,view.y,view.width,view.height);
      // The gorge hides the horizon naturally while the adjacent map is prepared.
      for(const zone of this.manifest.zones) {
        if(!intersects(zone.bounds,view))continue;
        const resource=this.resources.get(zone.id),asset=resource?.asset,b=zone.bounds,kind=zone.kind||zone.id,palette={...palettes[kind],...asset?.palette};
        c.save();c.beginPath();c.rect(b.x,b.y,b.width,b.height);c.clip();
        c.fillStyle=palette.ground;c.fillRect(b.x,b.y,b.width,b.height);
        // Lightweight, navigable ground is available even during a slow fetch.
        c.fillStyle=palette.path;c.fillRect(b.x,516,b.width,88);
        for(const chunk of resource?.chunks||[])if(intersects(chunk,view))c.drawImage(chunk.canvas,chunk.x,chunk.y);
        c.restore();
        if(kind==="corridor")this.drawCorridor(c,b,now);
        for(const ob of asset?.obstacles||zone.obstacles||[]) {
          if(!intersects({x:ob.x,y:ob.y,width:ob.width+12,height:ob.height+12},view))continue;
          c.fillStyle="#09101770";c.fillRect(ob.x+8,ob.y+9,ob.width,ob.height);
          // Filled geometry exactly matches the server's collision rectangles.
          c.fillStyle=kind==="ruins"?"#706777":"#536660";c.fillRect(ob.x,ob.y,ob.width,ob.height);
          c.strokeStyle=kind==="ruins"?"#c5ab7b":"#98b09b";c.lineWidth=2;c.strokeRect(ob.x+1,ob.y+1,ob.width-2,ob.height-2);
          c.fillStyle=kind==="ruins"?"#918392":"#6f8272";c.fillRect(ob.x+5,ob.y+5,Math.max(0,ob.width-10),Math.min(9,ob.height-10));
          if(kind==="ruins"&&ob.width>35&&ob.height>35){c.strokeStyle="#d7b77777";c.strokeRect(ob.x+12,ob.y+14,ob.width-24,ob.height-26);}
        }
        if(kind==="forest")this.sanctuary(c,zone.spawn||{x:295,y:580},palette.accent);
        if(kind==="ruins") {
          c.strokeStyle="#c0a2d933";c.lineWidth=2;
          c.beginPath();c.arc(3370,560,140,0,Math.PI*2);c.stroke();c.beginPath();c.arc(3370,560,128,0,Math.PI*2);c.stroke();
          c.fillStyle="#ddc38b99";c.font="600 12px ui-monospace,monospace";c.textAlign="center";c.fillText("RUINAS DEL ALBA",3370,746);
        }
      }
      this.sign(c,1570,560,"RUINAS",1);this.sign(c,2620,560,"BOSQUE",-1);
    }
    drawCorridor(c,b,now) {
      for(const y of [b.y,b.y+b.height]) {
        c.fillStyle="#182a2e";c.fillRect(b.x,y===b.y?y-65:y,b.width,65);
        for(let x=b.x;x<b.x+b.width;x+=48){
          c.fillStyle=((x-b.x)/48)%2?"#35494a":"#2b3e41";
          c.beginPath();c.moveTo(x,y);c.lineTo(x+14,y+(y===b.y?-45:45));c.lineTo(x+39,y+(y===b.y?-58:58));c.lineTo(x+49,y);c.closePath();c.fill();
        }
        c.strokeStyle="#76968a66";c.lineWidth=3;c.beginPath();c.moveTo(b.x,y);c.lineTo(b.x+b.width,y);c.stroke();
      }
      for(const x of [1860,2060,2260])for(const y of [462,658]) {
        c.fillStyle="#6c7d79";c.fillRect(x-4,y-7,8,14);
        c.fillStyle="#dfc189";c.beginPath();c.arc(x,y-5,3+Math.sin(now*.004+x)*.6,0,7);c.fill();
      }
      c.fillStyle="#b5cabe88";c.font="600 10px ui-monospace,monospace";c.textAlign="center";c.fillText("PASO DE LAS RAÍCES",2100,506);
    }
    sanctuary(c,p,color) {
      c.beginPath();c.arc(p.x,p.y,66,0,Math.PI*2);c.fillStyle="#89c4aa15";c.fill();c.strokeStyle="#94d1b755";c.lineWidth=2;c.stroke();
      c.beginPath();c.arc(p.x,p.y,43,0,Math.PI*2);c.strokeStyle="#b4d5b760";c.stroke();
      for(let i=0;i<8;i++){const a=i*Math.PI/4;c.fillStyle=color;c.fillRect(p.x+Math.cos(a)*61-2,p.y+Math.sin(a)*61-2,5,5);}
      c.fillStyle="#bdd4bc";c.font="700 10px ui-monospace,monospace";c.textAlign="center";c.fillText("SANTUARIO",p.x,p.y-93);
    }
    sign(c,x,y,label,dir) {
      c.fillStyle="#14242ac9";c.fillRect(x-63,y+52,126,32);c.strokeStyle="#85968888";c.lineWidth=1;c.strokeRect(x-63,y+52,126,32);
      c.fillStyle="#d9d7b6";c.font="700 10px ui-monospace,monospace";c.textAlign="center";c.fillText(dir>0?`${label} →`:`← ${label}`,x,y+72);
    }
  }
  window.WorldMaps=WorldMaps;
})();

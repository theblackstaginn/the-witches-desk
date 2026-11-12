// Bounded, decorative canvas simulation. No editor or storage access.
const lerp=(a,b,t)=>a+(b-a)*t;
const hash=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v)};
function noise(x){const i=Math.floor(x),t=x-i;return lerp(hash(i),hash(i+1),t*t*(3-2*t))*2-1}
export function createAmbientSmoke(canvas,workspace){
  const ctx=canvas.getContext('2d');
  if(!ctx)return ()=>{};
  const reduced=matchMedia('(prefers-reduced-motion:reduce)');
  const narrow=matchMedia('(max-width:760px)');
  let height=650,frame=0,last=0,clock=Math.random()*1000,credit=0,particles=[],disposed=false;
  const sprite=document.createElement('canvas');sprite.width=sprite.height=64;
  const sc=sprite.getContext('2d');
  if(!sc)return ()=>{};
  const mist=sc.createRadialGradient(32,32,0,32,32,32);
  mist.addColorStop(0,'rgba(217,208,227,.23)');mist.addColorStop(.35,'rgba(198,190,212,.12)');mist.addColorStop(1,'rgba(198,190,212,0)');
  sc.fillStyle=mist;sc.fillRect(0,0,64,64);
  function line(x,y,x2,y2,color,width){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke()}
  function ember(x,y,r,heat){
    const g=ctx.createRadialGradient(x,y,0,x,y,r*5);
    g.addColorStop(0,'rgba(255,113,42,'+heat*.65+')');g.addColorStop(.25,'rgba(182,35,17,'+heat*.4+')');g.addColorStop(1,'rgba(110,15,8,0)');
    ctx.fillStyle=g;ctx.fillRect(x-r*5,y-r*5,r*10,r*10);
    ctx.fillStyle='rgba(239,78,26,'+heat+')';ctx.beginPath();ctx.ellipse(x,y,r,r*.55,-.7,0,Math.PI*2);ctx.fill();
  }
  function objects(moving){
    ctx.lineCap='round';
    // One partly cropped incense stick, with an ashen end.
    line(-12,height-8,95,height-155,'#17100c',5);
    line(-12,height-8,95,height-155,'#70513a',2);
    line(92,height-151,95,height-155,'#a69b8d',3);
    // Bound dried sage: overlapping narrow leaves and pale twine.
    for(let i=0;i<32;i++){
      const x=-23+hash(i+30)*62,y=height-12-hash(i+80)*37;
      ctx.fillStyle=['#444b3b','#6b7057','#85866b','#343c32'][i%4];
      ctx.beginPath();ctx.ellipse(x,y,23+hash(i+9)*12,2+hash(i+12)*3,-.65+hash(i)*.2,0,Math.PI*2);ctx.fill();
    }
    for(let i=0;i<4;i++)line(1+i*5,height-16-i*4,12+i*5,height-42-i*4,'#a99c78',1.2);
    line(35,height-60,47,height-69,'#736a60',6);
    const heat=moving?.48+Math.max(0,noise(clock*1.3))*.5:.5;
    ember(95,height-155,1.9,heat);
    for(let i=0;i<4;i++)ember(36+i*3.3,height-60-i*2.7,1.3,moving?.24+Math.max(0,noise(clock*.8+i*7))*.45:.3);
  }
  function render(moving){
    ctx.clearRect(0,0,210,height);
    for(const p of particles){
      const fade=Math.sin(Math.PI*Math.min(1,p.age/p.life));
      ctx.globalAlpha=fade*(p.sage?.65:.48);
      const r=p.radius+p.age*(p.sage?2.5:1.6);
      ctx.drawImage(sprite,p.x-r,p.y-r,r*2,r*2);
    }
    ctx.globalAlpha=1;objects(moving);
  }
  function spawn(sage){
    particles.push({x:(sage?42:95)+(Math.random()-.5)*(sage?9:1),y:height-(sage?65:155),age:0,life:9+Math.random()*7,radius:sage?5:1.6,sage,seed:Math.random()*1000});
  }
  function tick(now){
    frame=requestAnimationFrame(tick);
    if(now-last<1000/30)return;
    const dt=Math.min((now-last)/1000,.06);last=now;clock+=dt;credit+=dt;
    while(credit>.065){credit-=.065;if(particles.length<260)spawn(false);if(particles.length<260)spawn(true)}
    for(const p of particles){
      p.age+=dt;
      const curl=noise(p.y*.024+clock*.35)+noise(p.y*.055-clock*.23+p.seed)*.45;
      p.x+=dt*(curl*(5+p.age*1.5)+noise(clock*.17)*8);
      p.y-=dt*((p.sage?13:22)+noise(p.seed+clock*.5)*4);
    }
    particles=particles.filter(p=>p.age<p.life&&p.y>-40);render(true);
  }
  function sync(){
    cancelAnimationFrame(frame);frame=0;last=performance.now();credit=0;particles=[];
    const active=!disposed&&!reduced.matches&&!narrow.matches&&!document.hidden&&!workspace.hidden;
    render(false);if(active)frame=requestAnimationFrame(tick);
  }
  function resize(){
    height=canvas.parentElement.clientHeight||650;
    const dpr=Math.min(devicePixelRatio||1,1.5);
    canvas.width=Math.round(210*dpr);canvas.height=Math.round(height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);sync();
  }
  const sizeObserver=new ResizeObserver(resize);sizeObserver.observe(canvas.parentElement);
  const visibilityObserver=new MutationObserver(sync);visibilityObserver.observe(workspace,{attributes:true,attributeFilter:['hidden']});
  reduced.addEventListener('change',sync);narrow.addEventListener('change',sync);
  document.addEventListener('visibilitychange',sync);
  window.addEventListener('pagehide',pause);window.addEventListener('pageshow',sync);
  function pause(){cancelAnimationFrame(frame);frame=0}
  resize();
  return ()=>{disposed=true;pause();sizeObserver.disconnect();visibilityObserver.disconnect();reduced.removeEventListener('change',sync);narrow.removeEventListener('change',sync);document.removeEventListener('visibilitychange',sync);window.removeEventListener('pagehide',pause);window.removeEventListener('pageshow',sync)};
}

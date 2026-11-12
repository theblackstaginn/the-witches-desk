// Presentation only: manuscript content and persistence stay in app.js.
import {createAmbientSmoke} from './smoke.js';
const workspace=document.getElementById('workspace');
const mobile=matchMedia('(max-width:760px)');
const compact=matchMedia('(max-width:1100px)');
const sides=[['left','toggleManuscripts','manuscriptRail'],['right','toggleDetails','detailsRail']];
function setRail(side,open){
  const [,buttonId,railId]=sides.find(([name])=>name===side);
  const rail=document.getElementById(railId);
  const button=document.getElementById(buttonId);
  if(!open && rail.contains(document.activeElement))button.focus();
  workspace.classList.toggle(side+'Closed',!open);
  button.setAttribute('aria-expanded',String(open));
}
function defaults(){setRail('left',!mobile.matches);setRail('right',!compact.matches)}
for(const [side,buttonId] of sides){
  document.getElementById(buttonId).addEventListener('click',()=>{
    const open=workspace.classList.contains(side+'Closed');
    if(open&&mobile.matches)setRail(side==='left'?'right':'left',false);
    setRail(side,open);
  });
}
workspace.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&mobile.matches){setRail('left',false);setRail('right',false)}
});
mobile.addEventListener('change',defaults);
compact.addEventListener('change',defaults);
defaults();
createAmbientSmoke(document.getElementById('smokeCanvas'),workspace);

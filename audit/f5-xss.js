// F5 — voltage_kv and status reach innerHTML unescaped. One layer file is
// substituted per phase to model a hostile community data contribution.
const fs=require('fs'), path=require('path');
const {open,findHit,jump,show}=require('./_harness');
const D=path.resolve(__dirname,'..','data','morocco');
const load=f=>JSON.parse(fs.readFileSync(path.join(D,f),'utf8'));

const corridors=load('planned-corridors.geojson');
corridors.features.forEach(f=>{
  f.properties.voltage_kv='<img src=x onerror="window.__XSS_TOOLTIP=1">';
  f.properties.name='SafeName<img src=y onerror="window.__XSS_NAME=1">'; // control: name IS escaped
});
const industrial=load('industrial.geojson');
industrial.features.forEach(f=>{ f.properties.status='operational" onmouseover="window.__XSS_ATTR=1'; });
const hrefTest=load('industrial.geojson');
hrefTest.features.forEach(f=>{ f.properties.source_url='javascript:window.__XSS_HREF=1'; });

// NOTE: only layers other than the one under test are hidden — hiding
// "interconnectors" would also hide lyr-grid-planned (see F1).
const hideOthers=(page,keep)=>page.evaluate(k=>{
  ['power-plants','oim-grid','interconnectors','planned-corridors','national-hv','industrial','digital']
    .filter(id=>!k.includes(id))
    .forEach(id=>{const i=document.querySelector('.layer-row[data-layer="'+id+'"] input'); if(i&&i.checked)i.click();});
},keep);

(async()=>{
  const results={};
  { // Phase A — hostile voltage_kv in the line tooltip (hover only, no click)
    const {page,close}=await open({dataOverrides:{'planned-corridors.geojson':corridors},waitForLayer:'lyr-grid-planned'});
    await hideOthers(page,['interconnectors','planned-corridors']);
    await jump(page,[-8,29],5); await page.waitForTimeout(2200);
    const pt=await findHit(page,'lyr-grid-planned');
    await page.mouse.move(pt.x-50,pt.y-50); await page.waitForTimeout(200);
    await page.mouse.move(pt.x,pt.y); await page.waitForTimeout(900);
    results.phaseA={
      tooltipHTML:(await page.evaluate(()=>document.querySelector('#tooltip').innerHTML)).trim(),
      voltage_kv_injection_executed:await page.evaluate(()=>!!window.__XSS_TOOLTIP),
      name_injection_executed:await page.evaluate(()=>!!window.__XSS_NAME)
    };
    await close();
  }
  { // Phase B — hostile status in the popup's class attribute
    const {page,close}=await open({dataOverrides:{'industrial.geojson':industrial}});
    await hideOthers(page,['industrial']);
    await jump(page,[-7.6,33.3],8); await page.waitForTimeout(2200);
    const pt=await findHit(page,'lyr-ind-points');
    await page.mouse.click(pt.x,pt.y); await page.waitForTimeout(800);
    results.phaseB={pillHTML:await page.evaluate(()=>{const e=document.querySelector('#popupBody .status-pill');return e?e.outerHTML.slice(0,220):'(none)';})};
    const box=await page.evaluate(()=>{const e=document.querySelector('#popupBody .status-pill');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
    await page.mouse.move(box.x-30,box.y); await page.waitForTimeout(150);
    await page.mouse.move(box.x,box.y); await page.waitForTimeout(500);
    results.phaseB.status_attribute_injection_executed=await page.evaluate(()=>!!window.__XSS_ATTR);
    await close();
  }
  { // Phase C — javascript: source_url. Emitted verbatim; Chromium blocks it
    //            while target="_blank" is present, so this is a latent sink.
    const {page,close}=await open({dataOverrides:{'industrial.geojson':hrefTest}});
    await hideOthers(page,['industrial']);
    await jump(page,[-7.6,33.3],8); await page.waitForTimeout(2200);
    const pt=await findHit(page,'lyr-ind-points');
    await page.mouse.click(pt.x,pt.y); await page.waitForTimeout(800);
    results.phaseC={renderedHref:await page.evaluate(()=>{const a=document.querySelector('#popupBody .source-row a');return a?a.getAttribute('href'):'(none)';})};
    results.phaseC.executed_as_shipped_with_target_blank=await page.evaluate(async()=>{
      document.querySelector('#popupBody .source-row a').click();
      await new Promise(r=>setTimeout(r,400)); return !!window.__XSS_HREF;
    });
    results.phaseC.executed_after_removing_target_blank=await page.evaluate(async()=>{
      const a=document.querySelector('#popupBody .source-row a'); a.removeAttribute('target'); a.click();
      await new Promise(r=>setTimeout(r,400)); return !!window.__XSS_HREF;
    });
    await close();
  }
  show(results);
  const ok = results.phaseA.voltage_kv_injection_executed===true
          && results.phaseA.name_injection_executed===false
          && results.phaseB.status_attribute_injection_executed===true;
  console.log(ok?'\nF5 REPRODUCED (2 confirmed sinks, 1 latent)':'\nF5 NOT reproduced');
  process.exit(ok?0:1);
})();

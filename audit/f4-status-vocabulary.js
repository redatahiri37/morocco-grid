// F4 — lyr-power-halo filters on announced/construction; the power data uses
// under_construction/planned, so the halo matches nothing and CSS has no
// .status-pill.under_construction rule.
const {open,isolate,jump,findHit,show}=require('./_harness');
(async()=>{
  const {page,close}=await open();
  await isolate(page,['power-plants']);
  await jump(page,[-6.0,32.0],5.6); await page.waitForTimeout(2500);
  const a=await page.evaluate(()=>{
    const m=window.__map, fs=m.getSource('src-power')._data.features;
    const st={}; fs.forEach(f=>{st[f.properties.status]=(st[f.properties.status]||0)+1;});
    const nonOp=fs.filter(f=>f.properties.status!=='operational');
    return {dataStatuses:st,
            haloFilter:JSON.stringify(m.getFilter('lyr-power-halo')),
            haloRendered:m.queryRenderedFeatures({layers:['lyr-power-halo']}).length,
            pointsRendered:m.queryRenderedFeatures({layers:['lyr-power-points']}).length,
            nonOperationalCount:nonOp.length,
            nonOperationalMW:nonOp.reduce((s,f)=>s+(f.properties.capacity_mw||0),0),
            digitalHaloFilter:JSON.stringify(m.getFilter('lyr-dig-halo')),
            digitalStatuses:[...new Set(window.__map.getSource('src-digital')._data.features.map(f=>f.properties.status))]};
  });
  await jump(page,[-2.93,35.17],10); await page.waitForTimeout(2200);
  const pt=await findHit(page,'lyr-power-points');
  await page.mouse.click(pt.x,pt.y); await page.waitForTimeout(800);
  const b=await page.evaluate(()=>{
    const e=document.querySelector('#popupBody .status-pill');
    const cs=getComputedStyle(e), dot=getComputedStyle(e.querySelector('.dot'));
    return {clickedFeature:document.querySelector('.pop-title').textContent,
            pillClass:e.className, pillText:e.textContent,
            background:cs.backgroundColor, color:cs.color, dotBackground:dot.backgroundColor};
  });
  show({halo:a,statusPill:b});
  const ok = a.haloRendered===0 && a.pointsRendered>0 && a.nonOperationalMW===3820
          && b.pillClass.includes('under_construction')
          && b.background==='rgba(0, 0, 0, 0)' && b.dotBackground==='rgba(0, 0, 0, 0)';
  console.log(ok?'\nF4 REPRODUCED':'\nF4 NOT reproduced');
  await close(); process.exit(ok?0:1);
})();

// F9 — every theme toggle re-runs wireLayerInteractions() and the cluster-click
// registration without removing the previous handlers.
const {open,show}=require('./_harness');
const counts=page=>page.evaluate(()=>{
  const m=window.__map, d=m._delegatedListeners||{}, out={};
  for(const k of Object.keys(d)) out[k]=d[k].length;
  return {delegated:out,mapLevelClick:((m._listeners&&m._listeners.click)||[]).length,
          layersInStyle:m.getStyle().layers.filter(l=>l.id.startsWith('lyr-')).length};
});
(async()=>{
  const {page,close}=await open();
  const series=[{toggle:0,...await counts(page)}];
  for(let i=1;i<=3;i++){
    await page.click('#themeToggle');
    await page.waitForFunction(()=>!!window.__map.getLayer('lyr-power-points'),{timeout:20000});
    await page.waitForTimeout(2000);
    series.push({toggle:i,...await counts(page)});
  }
  show(series);
  const c=series.map(s=>s.delegated.click);
  const ok = c[1]===2*c[0] && c[2]===3*c[0] && c[3]===4*c[0]
          && series.every(s=>s.layersInStyle===series[0].layersInStyle);
  console.log(ok?`\nF9 REPRODUCED (click handlers ${c.join(' -> ')}; rebuild itself stays correct)`:'\nF9 NOT reproduced');
  await close(); process.exit(ok?0:1);
})();

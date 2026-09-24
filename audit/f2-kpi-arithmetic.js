// F2 — "Renewables share" excludes solar_pv/solar_csp because the filter tests
// the literal string "solar", which occurs in zero features.
const {open,show}=require('./_harness');
(async()=>{
  const {page,close}=await open();
  const r=await page.evaluate(()=>{
    const fs=window.__map.getSource('src-power')._data.features;
    const cap=f=>f.properties.capacity_mw||0, ft=f=>f.properties.fuel_type||'';
    const sum=a=>a.reduce((s,f)=>s+cap(f),0);
    const ops=fs.filter(f=>f.properties.status==='operational');
    return {
      displayedKPIs:document.querySelector('#kpiGrid').innerText.replace(/\n/g,' | '),
      fuelTypesInData:[...new Set(fs.map(ft))].sort(),
      matchesLiteralSolar:fs.filter(f=>ft(f)==='solar').length,
      denominatorAllStatuses:sum(fs),
      numeratorAsCoded:sum(fs.filter(f=>['solar','wind','hydro'].includes(ft(f)))),
      numeratorWithSolarVariants:sum(fs.filter(f=>['solar','wind','hydro'].includes(ft(f).split('_')[0]))),
      solarMwDropped:sum(fs.filter(f=>ft(f).startsWith('solar'))),
      pumpedStorageInDenominator:sum(fs.filter(f=>ft(f)==='pumped_storage')),
      nonOperationalInDenominator:sum(fs)-sum(ops),
      shareAsCoded:Math.round(100*sum(fs.filter(f=>['solar','wind','hydro'].includes(ft(f))))/sum(fs)),
      shareCorrected:Math.round(100*sum(fs.filter(f=>['solar','wind','hydro'].includes(ft(f).split('_')[0])))/sum(fs)),
      shareOperationalOnly:Math.round(100*sum(ops.filter(f=>['solar','wind','hydro'].includes(ft(f).split('_')[0])))/sum(ops))
    };
  });
  show(r);
  const ok = r.matchesLiteralSolar===0 && r.shareAsCoded===23 && r.shareCorrected===39
             && /RENEWABLES SHARE\* \| 23%/.test(r.displayedKPIs);
  console.log(ok?'\nF2 REPRODUCED':'\nF2 NOT reproduced');
  await close(); process.exit(ok?0:1);
})();

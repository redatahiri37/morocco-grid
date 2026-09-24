// F7 — a 503 on one layer file is swallowed; the KPI panel publishes 0.0 GW
// under the caption "source: ONEE 2025" with no error surface.
const {open,show}=require('./_harness');
(async()=>{
  const {page,logs,close}=await open({failPaths:['power-plants.geojson'],waitForLayer:null});
  const r=await page.evaluate(()=>({
    kpiPanel:document.querySelector('#kpiGrid').innerText.replace(/\n/g,' | '),
    errorCardHidden:document.querySelector('#noTokenCard').classList.contains('hidden'),
    snapshotCaption:document.querySelectorAll('.panel-subhead .micro')[0].textContent,
    sidebarCounts:[...document.querySelectorAll('.layer-row')].map(x=>x.dataset.layer+'='+x.querySelector('.layer-count').textContent)
  }));
  r.onlySignal=logs.filter(l=>l.includes('MoroccoMap')).map(l=>l.split('\n')[0]);
  show(r);
  const ok = /TRACKED CAPACITY \| 0\.0 GW/.test(r.kpiPanel)
          && /RENEWABLES SHARE\* \| 0%/.test(r.kpiPanel)
          && r.errorCardHidden===true
          && /ONEE 2025/.test(r.snapshotCaption);
  console.log(ok?'\nF7 REPRODUCED':'\nF7 NOT reproduced');
  await close(); process.exit(ok?0:1);
})();

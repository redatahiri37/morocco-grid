// F10 — the methodology modal cites /docs/data/morocco/ and two documents that
// do not exist, and two data files ship unreferenced by any layer.
const fs=require('fs'), path=require('path');
const {open,show}=require('./_harness');
const ROOT=path.resolve(__dirname,'..');
(async()=>{
  const {page,close}=await open({waitForLayer:null});
  const r=await page.evaluate(async()=>{
    document.querySelector('#methodologyBtn').click();
    const body=document.querySelector('#methodologyModal .modal-body');
    const links=[...body.querySelectorAll('a')].map(a=>a.getAttribute('href')).filter(h=>h.endsWith('.md'));
    const status={};
    for(const h of links){
      try{ status[h]=(await fetch(new URL(h,location.href))).status; }catch(e){ status[h]='fetch error'; }
    }
    return {statedDataPath:(body.querySelector('code')||{}).textContent,
            modalOpen:!document.querySelector('#methodologyModal').classList.contains('hidden'),
            mdLinkStatus:status};
  });
  const cfg=fs.readFileSync(path.join(ROOT,'countries.config.js'),'utf8');
  const onDisk=fs.readdirSync(path.join(ROOT,'data','morocco')).filter(f=>f.endsWith('.geojson'));
  r.orphanedDataFiles=onDisk.filter(f=>f!=='boundary.geojson' && !cfg.includes(f))
    .map(f=>({file:f,features:JSON.parse(fs.readFileSync(path.join(ROOT,'data','morocco',f),'utf8')).features.length}));
  r.actualDataPath='./data/morocco/';
  r.docsDataDirExists=fs.existsSync(path.join(ROOT,'docs','data','morocco'));
  show(r);
  const ok = r.statedDataPath==='/docs/data/morocco/' && r.docsDataDirExists===false
          && Object.values(r.mdLinkStatus).every(s=>s===404)
          && r.orphanedDataFiles.length===2;
  console.log(ok?'\nF10 REPRODUCED':'\nF10 NOT reproduced');
  await close(); process.exit(ok?0:1);
})();

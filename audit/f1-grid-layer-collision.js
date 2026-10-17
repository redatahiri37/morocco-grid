// F1 — buildLineLayer() ignores dataLayerId: the interconnector layer is
// overwritten by planned-corridors, and both share one visibility namespace.
const {open,show}=require('./_harness');
(async()=>{
  const {page,close}=await open({waitForLayer:'lyr-grid-planned'});
  const r=await page.evaluate(async()=>{
    const m=window.__map, ids=['lyr-grid-hv','lyr-grid-mv','lyr-grid-lv','lyr-grid-planned','lyr-grid-idle'];
    const src=m.getSource('src-grid');
    const out={
      sidebarCounts:[...document.querySelectorAll('.layer-row')]
        .map(x=>x.dataset.layer+'='+x.querySelector('.layer-count').textContent),
      srcGridFeatureCount:src._data.features.length,
      srcGridContents:src._data.features.map(f=>f.properties.name),
      srcGridStatuses:[...new Set(src._data.features.map(f=>f.properties.status))],
      renderedNames:[...new Set(m.queryRenderedFeatures({layers:ids}).map(f=>f.properties.name))],
      visBefore:ids.map(l=>l+'='+m.getLayoutProperty(l,'visibility'))
    };
    document.querySelector('.layer-row[data-layer="interconnectors"] input').click();
    await new Promise(r=>setTimeout(r,200));
    out.visAfterHidingInterconnectorsOnly=ids.map(l=>l+'='+m.getLayoutProperty(l,'visibility'));
    out.plannedCheckboxStillChecked=document.querySelector('.layer-row[data-layer="planned-corridors"] input').checked;
    return out;
  });
  show(r);
  const ok = r.srcGridFeatureCount===8
    && !r.renderedNames.some(n=>/Interconnector I\b|Interconnector II\b|Algeria/.test(n))
    && r.visAfterHidingInterconnectorsOnly.every(v=>v.endsWith('none'))
    && r.plannedCheckboxStillChecked===true;
  console.log(ok?'\nF1 REPRODUCED':'\nF1 NOT reproduced');
  await close(); process.exit(ok?0:1);
})();

// F6 — promoteId:"id" keys feature state by properties.id (string slugs), but
// setHoverDim() passes the synthetic numeric ids from source._data.
const {open,jump,show}=require('./_harness');
async function hover(page,layer){
  const t=await page.evaluate(lid=>{
    const m=window.__map, fs=m.queryRenderedFeatures({layers:[lid]});
    if(!fs.length) return null;
    const p=m.project(fs[0].geometry.coordinates), r=m.getContainer().getBoundingClientRect();
    return {x:r.left+p.x,y:r.top+p.y,name:fs[0].properties.name,id:fs[0].id};
  },layer);
  if(!t) return null;
  await page.mouse.move(t.x-40,t.y-40); await page.waitForTimeout(150);
  await page.mouse.move(t.x,t.y); await page.waitForTimeout(500);
  const states=await page.evaluate(lid=>window.__map.queryRenderedFeatures({layers:[lid]})
    .map(f=>({id:f.id,name:f.properties.name,state:f.state})),layer);
  return {hovered:t,states};
}
(async()=>{
  const {page,close}=await open();
  await jump(page,[-7.6,33.3],8.5); await page.waitForTimeout(2500);
  const sources=await page.evaluate(()=>({
    promotedIds:{industrial:window.__map.queryRenderedFeatures({layers:['lyr-ind-points']}).map(f=>f.id).slice(0,3),
                 digital:window.__map.queryRenderedFeatures({layers:['lyr-dig-points']}).map(f=>f.id).slice(0,3)},
    syntheticIdsInSourceData:{industrial:window.__map.getSource('src-industrial')._data.features.map(f=>f.id).slice(0,3),
                              digital:window.__map.getSource('src-digital')._data.features.map(f=>f.id).slice(0,3)}
  }));
  const power=await hover(page,'lyr-power-points');
  await page.mouse.move(10,10); await page.waitForTimeout(400);
  const ind=await hover(page,'lyr-ind-points');
  await page.mouse.move(10,10); await page.waitForTimeout(400);
  const dig=await hover(page,'lyr-dig-points');
  show({idSpaces:sources,power_noPromoteId:power,industrial_promoteId:ind,digital_promoteId:dig});
  const dimmed=r=>r&&r.states.some(s=>s.state&&s.state.dim===true);
  const ok = dimmed(power) && !dimmed(ind) && !dimmed(dig);
  console.log(ok?'\nF6 REPRODUCED (works on power, no-op on industrial + digital)':'\nF6 NOT reproduced');
  await close(); process.exit(ok?0:1);
})();

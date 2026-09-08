// F3 — the circle-color match uses the same stale taxonomy, so 16/42 plants draw
// as #888; the popup badge falls back to solar amber for those same features.
const {open,isolate,jump,show}=require('./_harness');
const HEX=h=>[1,3,5].map(i=>parseInt(h.substr(i,2),16));
async function pixel(page,lngLat){
  return page.evaluate(async ll=>{
    const m=window.__map, p=m.project(ll), c=m.getCanvas();
    const gl=c.getContext('webgl2')||c.getContext('webgl');
    m.triggerRepaint(); await new Promise(r=>m.once('render',r));
    const dpr=window.devicePixelRatio||1, px=new Uint8Array(4);
    gl.readPixels(Math.round(p.x*dpr),Math.round(c.height-p.y*dpr),1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
    return [px[0],px[1],px[2]];
  },lngLat);
}
(async()=>{
  const {page,close}=await open();
  await isolate(page,['power-plants']);
  const cases=[
    ['Noor I (Ouarzazate CSP)','solar_csp',[-6.852,30.974],'#F59E0B'],
    ['Noor IV (Ouarzazate PV)','solar_pv', [-6.842,30.982],'#F59E0B'],
    ['Tangier I Wind Farm',    'wind',     [-5.65,35.75],  '#0D9488'],
    ['Jerada Coal Plant',      'coal',     [-2.16,34.31],  '#8B7F72']
  ];
  const rows=[];
  for(const [name,fuel,ll,intended] of cases){
    await jump(page,ll,11); await page.waitForTimeout(2200);
    const rgb=await pixel(page,ll);
    rows.push({name,fuel,renderedRGB:rgb,intended,intendedRGB:HEX(intended),
               matchesIntended:rgb.join()===HEX(intended).join(),
               isGreyFallback:rgb.join()==='136,136,136'});
  }
  const unmatched=await page.evaluate(()=>{
    const known=['solar','wind','hydro','coal','gas','oil'];
    const fs=window.__map.getSource('src-power')._data.features;
    const bad=fs.filter(f=>!known.includes(f.properties.fuel_type));
    return {count:bad.length,total:fs.length,
            mw:bad.reduce((s,f)=>s+(f.properties.capacity_mw||0),0),
            fuelTypes:[...new Set(bad.map(f=>f.properties.fuel_type))].sort(),
            popupDotForSolarCsp:'FUEL_COLOR["solar_csp"] is undefined -> falls back to FUEL_COLOR.solar (#F59E0B)'};
  });
  show({pixels:rows,unmatchedByColourExpression:unmatched});
  const ok = rows[0].isGreyFallback && rows[1].isGreyFallback
          && rows[2].matchesIntended && rows[3].matchesIntended
          && unmatched.count===16;
  console.log(ok?'\nF3 REPRODUCED':'\nF3 NOT reproduced');
  await close(); process.exit(ok?0:1);
})();

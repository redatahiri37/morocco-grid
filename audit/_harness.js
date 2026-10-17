/* Shared browser harness.
 *
 * The app loads MapLibre from unpkg and basemap/vector tiles from CARTO and
 * openinframap.org. Those hosts are unreachable from a sandboxed CI network, so
 * they are the only requests intercepted: MapLibre is served from the local
 * node_modules copy of the exact pinned version (4.7.1), tiles are stubbed.
 * Nothing in index.html / app.js / style.css / data/ is altered, except where a
 * script explicitly declares a `dataOverrides` entry to model hostile or
 * unavailable upstream data (F5, F7).
 */
const path=require('path'), fs=require('fs');
const { chromium } = require('playwright');
const { start } = require('./_serve');

const PORT=8791;
const ML=path.resolve(__dirname,'node_modules/maplibre-gl/dist');
const CHROME=process.env.CHROME_PATH||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=','base64');

async function open({dataOverrides={}, failPaths=[], waitForLayer='lyr-power-points'}={}){
  const server=await start(PORT);
  const browser=await chromium.launch({executablePath:CHROME,
    args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
  const ctx=await browser.newContext({viewport:{width:1400,height:900}});
  await ctx.route('**/*', route=>{
    const u=route.request().url();
    if(u.includes('unpkg.com')&&u.endsWith('.js'))
      return route.fulfill({status:200,contentType:'application/javascript',body:fs.readFileSync(ML+'/maplibre-gl.js')});
    if(u.includes('unpkg.com')&&u.endsWith('.css'))
      return route.fulfill({status:200,contentType:'text/css',body:fs.readFileSync(ML+'/maplibre-gl.css')});
    if(u.includes('fonts.googleapis.com')||u.includes('fonts.gstatic.com'))
      return route.fulfill({status:200,contentType:'text/css',body:''});
    if(u.includes('basemaps.cartocdn.com'))
      return route.fulfill({status:200,contentType:'image/png',body:PNG});
    if(u.includes('demotiles.maplibre.org')) return route.fulfill({status:200,body:Buffer.alloc(0)});
    if(u.includes('openinframap.org/tiles')) return route.fulfill({status:204,body:''});
    for(const f of failPaths) if(u.includes(f))
      return route.fulfill({status:503,contentType:'text/plain',body:'upstream unavailable'});
    for(const [name,obj] of Object.entries(dataOverrides)) if(u.includes(name))
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(obj)});
    if(u.startsWith('http://127.0.0.1:'+PORT)) return route.continue();
    return route.abort();
  });
  const page=await ctx.newPage();
  const logs=[];
  page.on('console',m=>logs.push(m.type()+': '+m.text()));
  page.on('pageerror',e=>logs.push('pageerror: '+e.message));
  // The app keeps `map` inside an IIFE; capture the instance without touching app.js.
  await page.addInitScript(()=>{
    let _ml;
    Object.defineProperty(window,'maplibregl',{configurable:true,get(){return _ml;},set(v){
      _ml=v;
      if(v&&v.Map&&!v.Map.__hooked){
        const O=v.Map;
        function H(o){ const m=new O(o); window.__map=m; return m; }
        H.prototype=O.prototype; H.__hooked=true; v.Map=H;
      }
    }});
  });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`,{waitUntil:'load'});
  await page.waitForFunction(()=>document.querySelector('#kpiGrid').children.length>0,{timeout:30000});
  if(waitForLayer)
    await page.waitForFunction(l=>window.__map&&window.__map.getLayer&&!!window.__map.getLayer(l),
                               waitForLayer,{timeout:30000});
  await page.waitForTimeout(2500);
  return { page, logs, close: async()=>{ await browser.close(); server.close(); } };
}

/** Toggle off every sidebar layer except the ones named. */
const isolate=(page,keep)=>page.evaluate(k=>{
  document.querySelectorAll('.layer-row').forEach(r=>{
    const i=r.querySelector('input');
    if(!k.includes(r.dataset.layer) && i.checked) i.click();
  });
},keep);

/** Scan the canvas for a screen point that actually hits `layer`. */
const findHit=(page,layer)=>page.evaluate(lid=>{
  const m=window.__map, r=m.getContainer().getBoundingClientRect();
  for(let x=4;x<r.width-4;x+=2) for(let y=4;y<r.height-4;y+=4){
    const q=m.queryRenderedFeatures([x,y],{layers:[lid]});
    if(q.length) return {x:r.left+x,y:r.top+y,hit:q[0].properties.name};
  }
  return null;
},layer);

const jump=(page,center,zoom)=>page.evaluate(a=>window.__map.jumpTo({center:a[0],zoom:a[1]}),[center,zoom]);
const show=o=>console.log(JSON.stringify(o,null,2));
module.exports={open,isolate,findHit,jump,show};

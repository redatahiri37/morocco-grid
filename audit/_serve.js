// Minimal static server for the app under test. No app code is modified.
const http=require('http'), fs=require('fs'), path=require('path');
const ROOT=path.resolve(__dirname,'..');
const T={'.html':'text/html','.js':'application/javascript','.css':'text/css',
         '.geojson':'application/json','.json':'application/json','.png':'image/png','.md':'text/markdown'};
function start(port){
  return new Promise(res=>{
    const s=http.createServer((req,rq)=>{
      let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html';
      const f=path.join(ROOT,p);
      if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){rq.writeHead(404);return rq.end('not found');}
      rq.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});
      fs.createReadStream(f).pipe(rq);
    }).listen(port,()=>res(s));
  });
}
module.exports={start,ROOT};

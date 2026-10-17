// F8 — the 947 national-HV lines have no hover/click handler, yet sit in
// queryableLayers(), so a click on one is swallowed and the stale popup stays.
const {open,isolate,jump,findHit,show}=require('./_harness');
(async()=>{
  const {page,close}=await open();
  await isolate(page,['power-plants','national-hv']);
  await jump(page,[-7.6,33.4],9); await page.waitForTimeout(2500);
  const plant=await findHit(page,'lyr-power-points');
  await page.mouse.click(plant.x,plant.y); await page.waitForTimeout(800);
  const afterPlant=await page.evaluate(()=>({open:document.querySelector('#popup').classList.contains('open'),
                                             title:document.querySelector('.pop-title').textContent}));
  const line=await findHit(page,'lyr-nhv-regional')
          || await findHit(page,'lyr-nhv-backbone')
          || await findHit(page,'lyr-nhv-distribution');
  await page.mouse.move(line.x-60,line.y-60); await page.waitForTimeout(200);
  await page.mouse.move(line.x,line.y); await page.waitForTimeout(800);
  const onHover={tooltipDisplay:await page.evaluate(()=>document.querySelector('#tooltip').style.display||'(unset)'),
                 canvasCursor:await page.evaluate(()=>window.__map.getCanvas().style.cursor||'(default)')};
  await page.mouse.click(line.x,line.y); await page.waitForTimeout(800);
  const afterLine=await page.evaluate(()=>({open:document.querySelector('#popup').classList.contains('open'),
                                            title:(document.querySelector('.pop-title')||{}).textContent}));
  const provenance=await page.evaluate(()=>{
    const p=window.__map.getSource('src-national-hv')._data.features;
    return {featureCount:p.length,
            withSourceUrl:p.filter(f=>f.properties.source_url).length,
            withPrecision:p.filter(f=>f.properties.precision).length,
            propertyKeys:Object.keys(p[0].properties)};
  });
  show({clickedPlant:plant,popupAfterPlantClick:afterPlant,hvLineHit:line,
        onHoveringHvLine:onHover,popupAfterHvLineClick:afterLine,
        methodologyClaim:'"source, source_url and precision so provenance is inspectable from the tooltip"',
        nationalHvProvenance:provenance});
  const ok = afterPlant.open && onHover.tooltipDisplay==='none' && onHover.canvasCursor==='(default)'
          && afterLine.open===true && afterLine.title===afterPlant.title
          && provenance.withSourceUrl===0 && provenance.withPrecision===0;
  console.log(ok?'\nF8 REPRODUCED':'\nF8 NOT reproduced');
  await close(); process.exit(ok?0:1);
})();

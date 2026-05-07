/* =============================================================
   Energy × Digital Nexus — Morocco Infrastructure Map
   Single-file app logic: country switch, layer manifest, map,
   tooltips, popups, methodology modal.

   v1.1 — public basemap pass:
     · Mapbox GL → MapLibre GL + CARTO dark-matter / positron
     · No token required (fully public, like enersite / Pawel)
     · WS boundary filtered out of render
     · DC bubble radius scales with capacity_estimate_mw
     · Planned / announced DCs rendered with lower opacity
   ============================================================= */

(function(){
  "use strict";

  // ---------- Config & country manifest ----------
  const CFG = window.APP_CONFIG || { defaultCountry:"morocco" };

  // Basemap: CARTO raster tiles (dark_all / light_all). We build the
  // MapLibre style inline so there is zero chance of a style-spec parse
  // failure at load time. Raster is heavier than vector but bulletproof.
  function basemapStyle(theme){
    const variant = theme === "dark" ? "dark_all" : "light_all";
    return {
      version: 8,
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: {
        "carto-base": {
          type: "raster",
          tiles: ["a","b","c","d"].map(s =>
            `https://${s}.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}.png`),
          tileSize: 256,
          attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions" target="_blank">CARTO</a>'
        }
      },
      layers: [{ id: "carto-base", type: "raster", source: "carto-base" }]
    };
  }

  // OpenInfraMap vector tiles — transmission grid, substations, plants.
  // Data is OSM under ODbL; attribution is mandatory.
  const OIM_TILES = "https://openinframap.org/tiles/{z}/{x}/{y}.pbf";
  const OIM_ATTR  = '<a href="https://openinframap.org" target="_blank">OpenInfraMap</a> (ODbL)';
  const COUNTRIES = window.COUNTRIES || {};
  const ENABLED   = (window.COUNTRIES_ENABLED || ["morocco"]).filter(k=>COUNTRIES[k]);
  const REPO_URL  = "https://github.com/redatahiri37/morocco-energy-digital-map";

  const FUEL_COLOR = {
    solar:"#F59E0B", wind:"#0D9488", hydro:"#3B82F6",
    coal:"#8B7F72",  gas:"#C77B3A", oil:"#A55A2A"
  };
  const DIGITAL_COLOR    = "#7C3AED";
  const INDUSTRIAL_COLOR = "#EA580C";
  const CABLE_COLOR      = "#F97316";
  const GRID_COLOR       = "#E5E4E0";

  // DC provider palette — shown in the sidebar legend, used on the map.
  // Keep the list short; anything unknown falls back to DIGITAL_COLOR.
  const PROVIDERS = [
    { key:"N+ONE",                     color:"#9B6BF0", label:"N+ONE (colocation)" },
    { key:"inwi",                      color:"#5BBFD9", label:"inwi (telco)" },
    { key:"Maroc Telecom (IAM)",       color:"#EC4899", label:"Maroc Telecom / IAM (telco)" },
    { key:"Naver / Nvidia consortium", color:"#F59E0B", label:"Naver × Nvidia (hyperscale, announced)" },
    { key:"Iozera",                    color:"#F97316", label:"Iozera (hyperscale, announced)" },
    { key:"Government of Morocco",     color:"#10B981", label:"Gov. of Morocco (sovereign)" },
    { key:"ADD (Agence de Développement du Digital)",
                                       color:"#10B981", label:"ADD (gov. sovereign)" }
  ];
  const PROVIDER_COLOR_EXPR = (function(){
    // Build a case expression: operator match → color; else category default
    const expr = ["case"];
    PROVIDERS.forEach(p => { expr.push(["==",["get","operator"], p.key], p.color); });
    expr.push(DIGITAL_COLOR); // default
    return expr;
  })();

  const LAYER_KIND = {
    "power-plants":"power",
    "oim-grid":"oim",
    "interconnectors":"grid",
    "planned-corridors":"grid",
    "grid-lines":"grid",        // legacy fallback
    "national-hv":"national-grid",
    "industrial":"industrial",
    "digital":"digital"
  };

  // Industrial sector colour palette
  const SECTOR_COLOR = {
    "phosphates / fertilisers": "#F59E0B",
    "phosphate mining":         "#F59E0B",
    "cement":                   "#A1A1AA",
    "steel":                    "#64748B",
    "automotive":               "#0EA5E9",
    "oil refining":             "#DC2626",
    "mining / metallurgy":      "#92400E",
  };
  const SECTOR_COLOR_EXPR = (function(){
    const expr = ["case"];
    Object.entries(SECTOR_COLOR).forEach(([k,v])=>{
      expr.push(["==",["get","sector"],k], v);
    });
    expr.push(INDUSTRIAL_COLOR); // default
    return expr;
  })();

  // ---------- State ----------
  let map = null;
  let currentCountry = null;
  let layerData      = {};   // id -> GeoJSON
  let visibility     = {};   // id -> bool
  let hoveredLayer   = null; // {layerId, featureId}
  let boundaryData   = null;

  // ---------- DOM refs ----------
  const $ = (sel)=>document.querySelector(sel);
  const tooltip = $("#tooltip");
  const popup   = $("#popup");
  const noTokenCard = $("#noTokenCard");

  // ---------- Theme ----------
  const savedTheme = localStorage.getItem("mg.theme") || "dark";
  document.body.dataset.theme = savedTheme;
  $("#themeToggle").addEventListener("click", ()=>{
    const next = document.body.dataset.theme === "dark" ? "light" : "dark";
    document.body.dataset.theme = next;
    localStorage.setItem("mg.theme", next);
    if(map){
      map.setStyle(basemapStyle(next));
      map.once("styledata", ()=>buildMapLayers(currentCountry));
    }
  });

  // ---------- Country selector ----------
  const countrySelect = $("#countrySelect");
  ENABLED.forEach(key=>{
    const o = document.createElement("option");
    o.value = key; o.textContent = COUNTRIES[key].label;
    countrySelect.appendChild(o);
  });
  Object.keys(COUNTRIES).filter(k=>!ENABLED.includes(k)).forEach(key=>{
    const o = document.createElement("option");
    o.value = key; o.textContent = COUNTRIES[key].label + " (soon)";
    o.disabled = true;
    countrySelect.appendChild(o);
  });

  // ---------- Panel collapse ----------
  const layout = document.querySelector(".layout");
  $("#panelCollapse").addEventListener("click", ()=>layout.classList.add("panel-collapsed"));
  $("#panelExpand").addEventListener("click",   ()=>layout.classList.remove("panel-collapsed"));

  ["githubLink","githubContribute","githubFooter"].forEach(id=>{ const el = $("#"+id); if(el) el.href = REPO_URL; });

  // ---------- Methodology modal ----------
  const methModal = $("#methodologyModal");
  $("#methodologyBtn").addEventListener("click", ()=>methModal.classList.remove("hidden"));
  $("#methodologyClose").addEventListener("click", ()=>methModal.classList.add("hidden"));
  methModal.addEventListener("click", (e)=>{ if(e.target === methModal) methModal.classList.add("hidden"); });

  // ---------- Utility ----------
  function fmtInvestment(v){
    if(v == null) return "—";
    if(v >= 1e9) return "$" + (v/1e9).toFixed(1).replace(/\.0$/,"") + "B";
    if(v >= 1e6) return "$" + Math.round(v/1e6) + "M";
    return "$" + v.toLocaleString();
  }
  function fmtCap(mw){ return mw == null ? "—" : mw.toLocaleString() + " MW"; }
  function escapeHtml(s){ return String(s==null?"":s).replace(/[&<>"']/g,c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }
  function layerKind(layerId){ return LAYER_KIND[layerId] || "other"; }

  function showMapError(reason){
    noTokenCard.classList.remove("hidden");
    if(reason) console.warn("[MoroccoMap]", reason);
  }

  // ---------- Boot ----------
  // Data + map init race each other. Before v1.5 the fetches were small
  // enough that loadAllData usually beat map.on("load"); the 221 KB WBG
  // transmission file flipped that and buildMapLayers started running
  // against empty layerData, so nothing rendered. Track both readiness
  // signals explicitly and only build when both are true.
  let dataReady = false, mapReady = false;
  function tryBuild(){
    if(dataReady && mapReady) buildMapLayers(currentCountry);
  }

  function boot(){
    const initialCountry = ENABLED.includes(CFG.defaultCountry) ? CFG.defaultCountry : ENABLED[0];
    countrySelect.value = initialCountry;
    currentCountry = initialCountry;
    loadAllData(initialCountry).then(()=>{
      renderLayerList(initialCountry);
      renderKPIs(initialCountry);
      renderProviderLegend();
      renderMethodologySources(initialCountry);
      dataReady = true;
      tryBuild();
    });
    bootMap();
  }

  function bootMap(){
    if(typeof maplibregl === "undefined"){ showMapError("MapLibre GL not loaded"); return; }
    try{
      const c = COUNTRIES[currentCountry];
      map = new maplibregl.Map({
        container: "map",
        style: basemapStyle(document.body.dataset.theme),
        center: c.center, zoom: c.zoom,
        attributionControl: false
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass:false }), "bottom-right");
      map.addControl(new maplibregl.AttributionControl({ compact:true }), "bottom-left");

      map.on("load", ()=>{ mapReady = true; tryBuild(); });
      map.on("click", (e)=>{
        const features = map.queryRenderedFeatures(e.point, { layers: queryableLayers() });
        if(features.length === 0) closePopup();
      });
      map.on("error", (e)=>{
        const msg = e && e.error && String(e.error.message||"");
        console.warn("[MoroccoMap] map error:", msg);
      });
    } catch(err){
      showMapError(String(err));
    }
  }

  // ---------- Data loading ----------
  async function loadAllData(countryKey){
    const c = COUNTRIES[countryKey];
    layerData = {};
    // Load boundary (if the file exists)
    try{
      const r = await fetch(c.dataPath + "boundary.geojson");
      if(r.ok) boundaryData = await r.json();
    } catch(e){ boundaryData = null; }

    const promises = c.layers.map(async (L, idx)=>{
      if(!L.file){ // OIM or other virtual layers — no fetch needed
        if(visibility[L.id] === undefined) visibility[L.id] = true;
        return;
      }
      try{
        const res = await fetch(c.dataPath + L.file);
        if(!res.ok) throw new Error(res.status + " " + L.file);
        const fc = await res.json();
        // Ensure each feature has a stable numeric id — required for feature-state
        fc.features.forEach((f,i)=>{ if(f.id == null) f.id = idx*10000 + i; });
        layerData[L.id] = fc;
      } catch(e){
        console.warn("[MoroccoMap] failed to load", L.file, e);
        layerData[L.id] = { type:"FeatureCollection", features:[] };
      }
      if(visibility[L.id] === undefined) visibility[L.id] = true;
    });
    await Promise.all(promises);
  }

  // ---------- Panel: layer list ----------
  function renderLayerList(countryKey){
    const c = COUNTRIES[countryKey];
    const host = $("#layerList");
    host.innerHTML = "";
    c.layers.forEach(L=>{
      const fc = layerData[L.id] || { features:[] };
      const kind = layerKind(L.id);
      const dotColor = (
        kind==="power"      ? FUEL_COLOR.solar :
        kind==="grid"       ? GRID_COLOR :
        kind==="oim"        ? "#6B7280" :
        kind==="industrial" ? INDUSTRIAL_COLOR :
        kind==="digital"    ? DIGITAL_COLOR : "#999"
      );
      const row = document.createElement("label");
      row.className = "layer-row";
      row.dataset.layer = L.id;
      row.innerHTML = `
        <input type="checkbox" ${visibility[L.id]!==false?"checked":""}>
        <span class="check"></span>
        <div class="layer-body">
          <div class="layer-head">
            <span class="layer-dot" style="background:${dotColor}"></span>
            <span class="layer-name">${escapeHtml(L.title)}</span>
            <span class="layer-count">${kind==="oim" ? "OSM live" : fc.features.length}</span>
          </div>
          <div class="layer-meta">
            <span>${escapeHtml(L.source)}</span> ·
            <a href="${escapeHtml(L.sourceUrl)}" target="_blank" rel="noopener">source ↗</a> ·
            <span class="micro">updated ${escapeHtml(L.updated)}</span>
          </div>
        </div>
      `;
      row.querySelector("input").addEventListener("change", (e)=>{
        const on = e.target.checked;
        visibility[L.id] = on;
        row.classList.toggle("muted", !on);
        applyLayerVisibility(L.id, on);
      });
      if(visibility[L.id] === false) row.classList.add("muted");
      host.appendChild(row);
    });
  }

  function renderProviderLegend(){
    const host = $("#providerLegend");
    if(!host) return;
    const fc = layerData["digital"] || { features:[] };
    // Count features per operator to show only providers that are in data
    const seen = new Set(fc.features.map(f => (f.properties||{}).operator).filter(Boolean));
    const rows = PROVIDERS
      .filter(p => seen.has(p.key))
      .map(p => `<div class="row"><span class="swatch" style="background:${p.color}"></span>${escapeHtml(p.label)}</div>`)
      .join("");
    const cableRow = fc.features.some(f => f.properties && f.properties.category === "cable_landing")
      ? `<div class="row cable"><span class="swatch" style="background:${CABLE_COLOR}"></span>Submarine cable landing</div>` : "";
    host.innerHTML = rows + cableRow;
  }

  function renderKPIs(countryKey){
    const host = $("#kpiGrid");
    const fcPower = layerData["power-plants"] || { features:[] };
    const fcDC    = layerData["digital"]      || { features:[] };
    const totalMW = fcPower.features.reduce((s,f)=>s + (f.properties.capacity_mw || 0), 0);
    const renewMW = fcPower.features.filter(f=>["solar","wind","hydro"].includes(f.properties.fuel_type))
                    .reduce((s,f)=>s + (f.properties.capacity_mw || 0), 0);
    const renewShare = totalMW ? Math.round(100 * renewMW / totalMW) : 0;
    const dcMW = fcDC.features.reduce((s,f)=>s + (f.properties.capacity_estimate_mw || 0), 0);
    const dcInvest = fcDC.features.reduce((s,f)=>s + (f.properties.investment_usd || 0), 0);
    host.innerHTML = `
      <div class="kpi"><div class="k">Tracked capacity</div>
        <div class="v">${(totalMW/1000).toFixed(1)}<small> GW</small></div></div>
      <div class="kpi"><div class="k">Renewables share*</div>
        <div class="v">${renewShare}<small>%</small></div></div>
      <div class="kpi"><div class="k">DC pipeline</div>
        <div class="v">${(dcMW/1000).toFixed(1)}<small> GW</small></div></div>
      <div class="kpi"><div class="k">DC investment</div>
        <div class="v">${fmtInvestment(dcInvest)}</div></div>
    `;
  }

  function renderMethodologySources(countryKey){
    const c = COUNTRIES[countryKey];
    const host = $("#methodologySources");
    if(!host) return;
    host.innerHTML = c.layers.map(L=>
      `<li><strong>${escapeHtml(L.title)}:</strong> ${escapeHtml(L.source)} — <a href="${escapeHtml(L.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(L.sourceUrl)}</a> <span class="micro">(updated ${escapeHtml(L.updated)})</span></li>`
    ).join("") + `<li><strong>Boundary:</strong> Natural Earth 1:50m Admin 0 — <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">naturalearthdata.com</a> (public domain).</li>` +
    `<li><strong>Basemap:</strong> MapLibre GL + <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a> + <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors — public, no token required.</li>`;
  }

  // ---------- Layer ID bookkeeping ----------
  // Each data layer produces a set of Mapbox GL layers. queryableLayers()
  // returns the ones that should catch clicks (everything except clusters).
  function layersFor(dataLayerId){
    const kind = layerKind(dataLayerId);
    if(dataLayerId === "oim-grid"){
      return ["lyr-oim-line-lv","lyr-oim-line-mv","lyr-oim-line-hv",
              "lyr-oim-substation-poly","lyr-oim-substation-pt"];
    }
    if(kind === "grid"){
      return [
        "lyr-grid-hv","lyr-grid-mv","lyr-grid-lv","lyr-grid-planned","lyr-grid-idle"
      ];
    }
    if(kind === "national-grid"){
      return ["lyr-nhv-backbone","lyr-nhv-regional","lyr-nhv-distribution"];
    }
    if(dataLayerId === "power-plants"){
      return ["lyr-power-clusters","lyr-power-cluster-count","lyr-power-halo","lyr-power-points","lyr-power-labels"];
    }
    if(dataLayerId === "industrial"){
      return ["lyr-ind-points","lyr-ind-labels"];
    }
    if(dataLayerId === "digital"){
      return ["lyr-dig-halo","lyr-dig-points","lyr-dig-cables","lyr-dig-labels"];
    }
    return [];
  }

  function queryableLayers(){
    // Only interactive (non-cluster, non-halo) layers
    const ids = [];
    if(map && map.getLayer("lyr-grid-hv"))      ids.push("lyr-grid-hv");
    if(map && map.getLayer("lyr-grid-mv"))      ids.push("lyr-grid-mv");
    if(map && map.getLayer("lyr-grid-lv"))      ids.push("lyr-grid-lv");
    if(map && map.getLayer("lyr-grid-planned")) ids.push("lyr-grid-planned");
    if(map && map.getLayer("lyr-grid-idle"))    ids.push("lyr-grid-idle");
    if(map && map.getLayer("lyr-nhv-backbone"))     ids.push("lyr-nhv-backbone");
    if(map && map.getLayer("lyr-nhv-regional"))     ids.push("lyr-nhv-regional");
    if(map && map.getLayer("lyr-nhv-distribution")) ids.push("lyr-nhv-distribution");
    if(map && map.getLayer("lyr-power-points")) ids.push("lyr-power-points");
    if(map && map.getLayer("lyr-ind-points"))   ids.push("lyr-ind-points");
    if(map && map.getLayer("lyr-dig-points"))   ids.push("lyr-dig-points");
    if(map && map.getLayer("lyr-dig-cables"))   ids.push("lyr-dig-cables");
    return ids;
  }

  // ---------- Build map layers ----------
  function buildMapLayers(countryKey){
    if(!map) return;

    // OpenInfraMap vector overlay — full OSM-sourced transmission grid,
    // substations and plants. Free, ODbL, no API key. Rendered below all
    // editorial features so our announced/planned overlays stay on top.
    addOrReplace("src-oim", {
      type: "vector",
      tiles: [OIM_TILES],
      minzoom: 0, maxzoom: 17,
      attribution: OIM_ATTR
    });
    const oimIds = ["lyr-oim-line-lv","lyr-oim-line-mv","lyr-oim-line-hv",
                    "lyr-oim-substation-poly","lyr-oim-substation-pt"];
    oimIds.forEach(id=>{ if(map.getLayer(id)) map.removeLayer(id); });

    // Lines — styled by voltage. OIM exposes a numeric `voltage` (volts).
    // Non-numeric / multi-voltage tags coerce to 0 and fall into LV.
    const voltExpr = ["coalesce", ["to-number", ["get","voltage"]], 0];
    map.addLayer({
      id:"lyr-oim-line-lv", type:"line", source:"src-oim", "source-layer":"power_line",
      filter:["<", voltExpr, 100000],
      minzoom: 8,
      paint:{ "line-color":"rgba(229,228,224,0.22)", "line-width":0.6 }
    });
    map.addLayer({
      id:"lyr-oim-line-mv", type:"line", source:"src-oim", "source-layer":"power_line",
      filter:["all",[">=",voltExpr,100000],["<",voltExpr,300000]],
      paint:{ "line-color":"rgba(229,228,224,0.55)", "line-width":1.0 }
    });
    map.addLayer({
      id:"lyr-oim-line-hv", type:"line", source:"src-oim", "source-layer":"power_line",
      filter:[">=", voltExpr, 300000],
      paint:{ "line-color":GRID_COLOR, "line-width":1.8, "line-opacity":0.9 }
    });

    // Substations — polygon at high zoom, points at low zoom
    map.addLayer({
      id:"lyr-oim-substation-poly", type:"fill", source:"src-oim", "source-layer":"power_substation",
      minzoom: 10,
      paint:{
        "fill-color":"rgba(229,228,224,0.15)",
        "fill-outline-color":"rgba(229,228,224,0.55)"
      }
    });
    map.addLayer({
      id:"lyr-oim-substation-pt", type:"circle", source:"src-oim", "source-layer":"power_substation_point",
      minzoom: 5,
      paint:{
        "circle-color":"rgba(229,228,224,0.75)",
        "circle-radius":["interpolate",["linear"],["zoom"], 5,1.2, 10,3.5],
        "circle-stroke-color":"rgba(0,0,0,0.55)",
        "circle-stroke-width":0.5
      }
    });

    // Boundary: dissolved single polygon (Morocco + Southern Provinces as
    // one territory — no internal border). The geojson was pre-dissolved
    // by scripts/build-transmission-geojson.py companion pass.
    if(boundaryData){
      addOrReplace("src-boundary", { type:"geojson", data: boundaryData });
      if(!map.getLayer("lyr-boundary-fill")){
        map.addLayer({
          id:"lyr-boundary-fill", type:"fill", source:"src-boundary",
          paint:{
            "fill-color":"rgba(255,255,255,0.03)",
            "fill-outline-color":"rgba(0,0,0,0)"
          }
        });
      }
      if(!map.getLayer("lyr-boundary-line")){
        map.addLayer({
          id:"lyr-boundary-line", type:"line", source:"src-boundary",
          paint:{
            "line-color":"rgba(255,255,255,0.28)",
            "line-width":1.0,
            "line-dasharray":[3,2]
          }
        });
      }
    }

    // Each build*Layer call is isolated: if one throws (bad MapLibre
    // expression, missing source, etc.), the rest still render and the
    // error surfaces in the console for the map-debugger agent.
    const safe = (label, fn) => {
      try { fn(); }
      catch(e){ console.error("[MoroccoMap] layer failed:", label, e); }
    };

    // Operational interconnectors (ES-MA I/II, DZ-MA idle)
    safe("interconnectors", () =>
      buildLineLayer("interconnectors", layerData["interconnectors"] || { features:[] }));

    // Planned corridors (ES-MA III, Xlinks, Dakhla HVDC, WBG 2018 planned)
    safe("planned-corridors", () =>
      buildLineLayer("planned-corridors", layerData["planned-corridors"] || { features:[] }));

    // National HV grid — 947 ONEE transmission lines, voltage-classed
    // (400 kV backbone, 225/150 kV regional, 60 kV distribution).
    safe("national-hv", () =>
      buildNationalGridLayer(layerData["national-hv"] || { features:[] }));

    // Power plants (clustered)
    safe("power-plants", () =>
      buildPowerLayer(layerData["power-plants"] || { features:[] }));

    // Industrial — sector-coloured by SECTOR_COLOR_EXPR
    safe("industrial", () =>
      buildPointLayer({
        idPrefix:     "lyr-ind",
        sourceId:     "src-industrial",
        data:         layerData["industrial"] || { features:[] },
        color:        SECTOR_COLOR_EXPR,
        minZoomLabel: 7,
        labelField:   "name"
      }));

    // Digital infrastructure — split cables (diamond) from regular DC circles
    safe("digital", () =>
      buildDigitalLayer(layerData["digital"] || { features:[] }));

    // Apply visibility from state
    Object.keys(visibility).forEach(id=>applyLayerVisibility(id, visibility[id]));

    // Wire interactions
    wireLayerInteractions();
  }

  function addOrReplace(id, spec){
    if(map.getSource(id)) map.removeSource(id);
    map.addSource(id, spec);
  }

  function buildLineLayer(dataLayerId, fc){
    const srcId = "src-grid";
    const ids = ["lyr-grid-hv","lyr-grid-mv","lyr-grid-lv","lyr-grid-planned","lyr-grid-idle"];
    ids.forEach(id=>{ if(map.getLayer(id)) map.removeLayer(id); });
    addOrReplace(srcId, { type:"geojson", data: fc });

    // Editorial overlay — interconnectors, HVDC corridors, planned/idle
    // strategic links. Rendered bold/colored on top of OIM's grey OSM grid
    // so the strategic story pops.
    map.addLayer({ id:"lyr-grid-hv", type:"line", source:srcId,
      filter:["all",["==",["get","status"],"operational"],[">=",["get","voltage_kv"],300]],
      paint:{ "line-color":"#0D9488", "line-width":2.6, "line-opacity":0.95 }});
    map.addLayer({ id:"lyr-grid-mv", type:"line", source:srcId,
      filter:["all",["==",["get","status"],"operational"],[">=",["get","voltage_kv"],100],["<",["get","voltage_kv"],300]],
      paint:{ "line-color":"#0D9488", "line-width":1.6, "line-opacity":0.85 }});
    map.addLayer({ id:"lyr-grid-lv", type:"line", source:srcId,
      filter:["all",["==",["get","status"],"operational"],["<",["get","voltage_kv"],100]],
      paint:{ "line-color":"#0D9488", "line-width":1.0, "line-opacity":0.6 }});
    map.addLayer({ id:"lyr-grid-planned", type:"line", source:srcId,
      filter:["==",["get","status"],"planned"],
      paint:{ "line-color":"#a37df0", "line-width":2.0, "line-opacity":0.95, "line-dasharray":[2,2] }});
    map.addLayer({ id:"lyr-grid-idle", type:"line", source:srcId,
      filter:["==",["get","status"],"idle"],
      paint:{ "line-color":"#8a877c", "line-width":1.6, "line-opacity":0.7, "line-dasharray":[1,2] }});
  }

  // National HV grid — own source/layers, filtered by grid_class (backbone /
  // regional / distribution). Independent from the editorial src-grid so
  // both can render simultaneously.
  function buildNationalGridLayer(fc){
    const srcId = "src-national-hv";
    const ids = ["lyr-nhv-backbone","lyr-nhv-regional","lyr-nhv-distribution"];
    ids.forEach(id=>{ if(map.getLayer(id)) map.removeLayer(id); });
    addOrReplace(srcId, { type:"geojson", data: fc });

    map.addLayer({ id:"lyr-nhv-distribution", type:"line", source:srcId,
      filter:["==",["get","grid_class"],"distribution"],
      minzoom: 7,
      paint:{ "line-color":"#93c5fd", "line-width":0.6, "line-opacity":0.45 }});
    map.addLayer({ id:"lyr-nhv-regional", type:"line", source:srcId,
      filter:["==",["get","grid_class"],"regional"],
      paint:{ "line-color":"#60a5fa", "line-width":1.2, "line-opacity":0.7 }});
    map.addLayer({ id:"lyr-nhv-backbone", type:"line", source:srcId,
      filter:["==",["get","grid_class"],"backbone"],
      paint:{ "line-color":"#3b82f6", "line-width":2.0, "line-opacity":0.9 }});
  }


  function buildPowerLayer(fc){
    const srcId = "src-power";
    const toRemove = ["lyr-power-clusters","lyr-power-cluster-count","lyr-power-halo","lyr-power-points","lyr-power-labels"];
    toRemove.forEach(id=>{ if(map.getLayer(id)) map.removeLayer(id); });

    addOrReplace(srcId, {
      type:"geojson", data: fc,
      cluster: true, clusterMaxZoom: 6, clusterRadius: 35,
      generateId: false
    });

    // Cluster bubbles
    map.addLayer({
      id:"lyr-power-clusters", type:"circle", source:srcId,
      filter:["has","point_count"],
      paint:{
        "circle-color":"rgba(245,158,11,0.85)",
        "circle-radius":["step",["get","point_count"], 14, 3, 18, 6, 22],
        "circle-stroke-color":"#0e0e0d",
        "circle-stroke-width":1.5
      }
    });
    map.addLayer({
      id:"lyr-power-cluster-count", type:"symbol", source:srcId,
      filter:["has","point_count"],
      layout:{
        "text-field":["get","point_count_abbreviated"],
        "text-font":["Open Sans Bold","Arial Unicode MS Bold"],
        "text-size":11,
        "text-allow-overlap":true
      },
      paint:{ "text-color":"#0e0e0d" }
    });

    // Halo for announced/construction status
    map.addLayer({
      id:"lyr-power-halo", type:"circle", source:srcId,
      filter:["all",["!",["has","point_count"]],["in",["get","status"],["literal",["announced","construction"]]]],
      paint:{
        "circle-color":"rgba(245,158,11,0.25)",
        "circle-radius":11,
        "circle-blur":0.3
      }
    });

    // Individual plants, color by fuel
    map.addLayer({
      id:"lyr-power-points", type:"circle", source:srcId,
      filter:["!",["has","point_count"]],
      paint:{
        "circle-color":[
          "match",["get","fuel_type"],
          "solar", FUEL_COLOR.solar,
          "wind",  FUEL_COLOR.wind,
          "hydro", FUEL_COLOR.hydro,
          "coal",  FUEL_COLOR.coal,
          "gas",   FUEL_COLOR.gas,
          "oil",   FUEL_COLOR.oil,
          "#888"
        ],
        "circle-radius":[
          "interpolate",["linear"],["zoom"],
          4, 4,
          7, 6,
          10, 8
        ],
        "circle-stroke-color":"rgba(0,0,0,0.55)",
        "circle-stroke-width":1.5,
        "circle-opacity":[
          "case",
          ["boolean",["feature-state","dim"],false], 0.3,
          1
        ]
      }
    });

    // Labels at zoom >= 7
    map.addLayer({
      id:"lyr-power-labels", type:"symbol", source:srcId,
      filter:["!",["has","point_count"]],
      minzoom: 7,
      layout:{
        "text-field":["get","name"],
        "text-font":["Open Sans Regular","Arial Unicode MS Regular"],
        "text-size":10.5,
        "text-offset":[0, 1.1],
        "text-anchor":"top",
        "text-allow-overlap":false
      },
      paint:{
        "text-color":"#f1efe9",
        "text-halo-color":"rgba(0,0,0,0.85)",
        "text-halo-width":1.2
      }
    });

    // Cluster click → zoom in
    map.on("click","lyr-power-clusters",(e)=>{
      const f = e.features[0];
      const clusterId = f.properties.cluster_id;
      map.getSource(srcId).getClusterExpansionZoom(clusterId, (err, zoom)=>{
        if(err) return;
        map.easeTo({ center: f.geometry.coordinates, zoom });
      });
    });
    map.on("mouseenter","lyr-power-clusters", ()=>{ map.getCanvas().style.cursor="pointer"; });
    map.on("mouseleave","lyr-power-clusters", ()=>{ map.getCanvas().style.cursor=""; });
  }

  function buildPointLayer(opts){
    const { idPrefix, sourceId, data, color, minZoomLabel, labelField } = opts;
    const pts = idPrefix + "-points";
    const lbs = idPrefix + "-labels";
    [pts, lbs].forEach(id=>{ if(map.getLayer(id)) map.removeLayer(id); });
    addOrReplace(sourceId, { type:"geojson", data, promoteId: "id" });

    map.addLayer({
      id: pts, type:"circle", source: sourceId,
      paint:{
        "circle-color": color,
        "circle-radius":["interpolate",["linear"],["zoom"], 4, 4, 7, 6, 10, 8],
        "circle-stroke-color":"rgba(0,0,0,0.55)",
        "circle-stroke-width":1.5,
        "circle-opacity":[
          "case",
          ["boolean",["feature-state","dim"],false], 0.3,
          1
        ]
      }
    });
    map.addLayer({
      id: lbs, type:"symbol", source: sourceId,
      minzoom: minZoomLabel,
      layout:{
        "text-field":["get", labelField],
        "text-font":["Open Sans Regular","Arial Unicode MS Regular"],
        "text-size":10.5,
        "text-offset":[0, 1.1],
        "text-anchor":"top",
        "text-allow-overlap":false
      },
      paint:{
        "text-color":"#f1efe9",
        "text-halo-color":"rgba(0,0,0,0.85)",
        "text-halo-width":1.2
      }
    });
  }

  function buildDigitalLayer(fc){
    const srcId = "src-digital";
    const ids = ["lyr-dig-halo","lyr-dig-points","lyr-dig-cables","lyr-dig-labels"];
    ids.forEach(id=>{ if(map.getLayer(id)) map.removeLayer(id); });
    addOrReplace(srcId, { type:"geojson", data: fc, promoteId: "id" });

    // Halo for announced status (pulsing-style, static render)
    map.addLayer({
      id:"lyr-dig-halo", type:"circle", source: srcId,
      filter:["any",["==",["get","status"],"announced"],["==",["get","status"],"construction"]],
      paint:{
        "circle-color":"rgba(124,58,237,0.22)",
        "circle-radius":13,
        "circle-blur":0.35
      }
    });

    // Regular DCs (non-cable). Radius scales with capacity; planned/announced
    // DCs render at lower opacity with a dashed stroke so the pipeline is
    // visually distinct from energised capacity.
    map.addLayer({
      id:"lyr-dig-points", type:"circle", source: srcId,
      filter:["!=",["get","category"],"cable_landing"],
      paint:{
        "circle-color": PROVIDER_COLOR_EXPR,
        "circle-radius":[
          "interpolate",["linear"],
          ["coalesce",["get","capacity_estimate_mw"], 3],
          0, 5,
          10, 7,
          40, 11,
          100, 16,
          300, 22
        ],
        "circle-stroke-color":[
          "case",
          ["in",["get","status"],["literal",["announced","construction","planned"]]], "rgba(163,125,240,0.9)",
          "rgba(0,0,0,0.6)"
        ],
        "circle-stroke-width":1.5,
        "circle-opacity":[
          "case",
          ["boolean",["feature-state","dim"],false], 0.25,
          ["==",["get","status"],"announced"], 0.38,
          ["==",["get","status"],"planned"],   0.38,
          ["==",["get","status"],"construction"], 0.65,
          0.95
        ]
      }
    });

    // Cable landings — symbol diamond
    map.addLayer({
      id:"lyr-dig-cables", type:"symbol", source: srcId,
      filter:["==",["get","category"],"cable_landing"],
      layout:{
        "text-field":"◆",
        "text-font":["Open Sans Bold","Arial Unicode MS Bold"],
        "text-size":["interpolate",["linear"],["zoom"], 4, 13, 10, 19],
        "text-allow-overlap":true
      },
      paint:{
        "text-color": CABLE_COLOR,
        "text-halo-color":"rgba(0,0,0,0.85)",
        "text-halo-width":1.2,
        "text-opacity":["case",["boolean",["feature-state","dim"],false], 0.3, 1]
      }
    });

    // Labels
    map.addLayer({
      id:"lyr-dig-labels", type:"symbol", source: srcId,
      minzoom: 7,
      layout:{
        "text-field":["get","name"],
        "text-font":["Open Sans Regular","Arial Unicode MS Regular"],
        "text-size":10.5,
        "text-offset":[0, 1.2],
        "text-anchor":"top",
        "text-allow-overlap":false
      },
      paint:{
        "text-color":"#f1efe9",
        "text-halo-color":"rgba(0,0,0,0.85)",
        "text-halo-width":1.2
      }
    });
  }

  // ---------- Layer interactions (hover dim + tooltip + click) ----------
  function wireLayerInteractions(){
    const pointLayers = [
      { id:"lyr-power-points", src:"src-power",    dataLayer:"power-plants" },
      { id:"lyr-ind-points",   src:"src-industrial", dataLayer:"industrial" },
      { id:"lyr-dig-points",   src:"src-digital",  dataLayer:"digital" },
      { id:"lyr-dig-cables",   src:"src-digital",  dataLayer:"digital" }
    ];
    const lineLayers = [
      { id:"lyr-grid-hv",      src:"src-grid", dataLayer:"grid-lines" },
      { id:"lyr-grid-mv",      src:"src-grid", dataLayer:"grid-lines" },
      { id:"lyr-grid-lv",      src:"src-grid", dataLayer:"grid-lines" },
      { id:"lyr-grid-planned", src:"src-grid", dataLayer:"grid-lines" },
      { id:"lyr-grid-idle",    src:"src-grid", dataLayer:"grid-lines" }
    ];

    pointLayers.forEach(({id, src, dataLayer})=>{
      if(!map.getLayer(id)) return;
      map.on("mousemove", id, (e)=>{
        const f = e.features[0]; if(!f) return;
        map.getCanvas().style.cursor = "pointer";
        setHoverDim(src, id, f.id);
        showPointTooltip(dataLayer, f, e.point);
      });
      map.on("mouseleave", id, ()=>{
        map.getCanvas().style.cursor = "";
        clearHoverDim();
        hideTooltip();
      });
      map.on("click", id, (e)=>{
        e.originalEvent.stopPropagation();
        const f = e.features[0];
        openPointPopup(dataLayer, f);
        map.easeTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom(), 7), duration: 600 });
      });
    });

    lineLayers.forEach(({id, src, dataLayer})=>{
      if(!map.getLayer(id)) return;
      map.on("mousemove", id, (e)=>{
        const f = e.features[0]; if(!f) return;
        map.getCanvas().style.cursor = "pointer";
        showLineTooltip(f, e.point);
      });
      map.on("mouseleave", id, ()=>{
        map.getCanvas().style.cursor = "";
        hideTooltip();
      });
      map.on("click", id, (e)=>{
        e.originalEvent.stopPropagation();
        openLinePopup(e.features[0]);
      });
    });
  }

  // ---------- Hover dim: set `dim=true` on all OTHER features in a layer ----------
  function setHoverDim(sourceId, layerId, keepId){
    clearHoverDim();
    const fc = map.getSource(sourceId) && map.getSource(sourceId)._data;
    if(!fc || !fc.features) return;
    fc.features.forEach(f=>{
      if(f.id !== keepId && f.id != null){
        map.setFeatureState({ source: sourceId, id: f.id }, { dim: true });
      }
    });
    hoveredLayer = { sourceId, keepId };
  }
  function clearHoverDim(){
    if(!hoveredLayer) return;
    const { sourceId } = hoveredLayer;
    const fc = map.getSource(sourceId) && map.getSource(sourceId)._data;
    if(fc && fc.features){
      fc.features.forEach(f=>{
        if(f.id != null) map.setFeatureState({ source: sourceId, id: f.id }, { dim: false });
      });
    }
    hoveredLayer = null;
  }

  function applyLayerVisibility(dataLayerId, on){
    if(!map) return;
    const ids = layersFor(dataLayerId);
    ids.forEach(id=>{
      if(map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    });
  }

  // ---------- Tooltip ----------
  function showPointTooltip(dataLayerId, f, point){
    const p = f.properties || {};
    const kind = layerKind(dataLayerId);
    let metric = "";
    if(kind === "power")           metric = `${fmtCap(p.capacity_mw)} · ${p.fuel_type || ""}`;
    else if(kind === "industrial") metric = `${p.sector || ""} · est. ${fmtCap(p.estimated_demand_mw)}`;
    else if(kind === "digital")    metric = p.capacity_estimate_mw ? `${fmtCap(p.capacity_estimate_mw)} · ${p.operator || ""}` : (p.operator || p.category || "");
    tooltip.innerHTML = `
      <div class="tt-name">${escapeHtml(p.name)}</div>
      <div class="tt-metric">${escapeHtml(metric)}</div>
      <div class="tt-meta">
        ${p.source_url ? `<a href="${escapeHtml(p.source_url)}" target="_blank" rel="noopener">${escapeHtml(p.source || "—")}</a>` : escapeHtml(p.source || "—")}
        ${p.commissioning_year || p.year ? " · " + escapeHtml(p.commissioning_year || p.year) : ""}
      </div>`;
    positionTooltip(point);
  }
  function showLineTooltip(f, point){
    const p = f.properties || {};
    tooltip.innerHTML = `
      <div class="tt-name">${escapeHtml(p.name)}</div>
      <div class="tt-metric">${p.voltage_kv} kV · ${escapeHtml(p.status || "")}</div>
      <div class="tt-meta">${p.source_url ? `<a href="${escapeHtml(p.source_url)}" target="_blank" rel="noopener">${escapeHtml(p.source || "—")}</a>` : escapeHtml(p.source || "—")}</div>`;
    positionTooltip(point);
  }
  function positionTooltip(point){
    const rect = $("#map").getBoundingClientRect();
    tooltip.style.left = (rect.left + point.x) + "px";
    tooltip.style.top  = (rect.top  + point.y) + "px";
    tooltip.style.display = "block";
  }
  function hideTooltip(){ tooltip.style.display = "none"; }

  // ---------- Popup ----------
  function openPointPopup(dataLayerId, f){
    const p = f.properties || {};
    const kind = layerKind(dataLayerId);
    const badgeClass = kind === "power" ? "power" : kind === "industrial" ? "industrial" : kind === "digital" ? "digital" : "grid";
    const badgeLabel = kind === "power" ? "Generation"
                     : kind === "industrial" ? "Industrial consumer"
                     : kind === "digital" ? (p.category === "cable_landing" ? "Submarine cable" : "Data center")
                     : "Infrastructure";

    let stats = "";
    if(kind === "power"){
      stats = `
        <div class="cell"><div class="k">Capacity</div><div class="v">${fmtCap(p.capacity_mw)}</div></div>
        <div class="cell"><div class="k">Fuel</div><div class="v" style="text-transform:capitalize">${escapeHtml(p.fuel_type)}</div></div>
        <div class="cell"><div class="k">Technology</div><div class="v" style="font-size:12px">${escapeHtml(p.tech || "—")}</div></div>
        <div class="cell"><div class="k">${p.status==="operational"?"Commissioned":"Target year"}</div><div class="v">${escapeHtml(p.commissioning_year || "—")}</div></div>`;
    } else if(kind === "industrial"){
      stats = `
        <div class="cell"><div class="k">Sector</div><div class="v" style="font-size:12px">${escapeHtml(p.sector)}</div></div>
        <div class="cell"><div class="k">Est. demand</div><div class="v">${fmtCap(p.estimated_demand_mw)}</div></div>
        <div class="cell"><div class="k">Grid connection</div><div class="v" style="font-size:11.5px">${escapeHtml(p.grid_connection || "—")}</div></div>
        <div class="cell"><div class="k">Precision</div><div class="v" style="text-transform:capitalize">${escapeHtml(p.precision || "—")}</div></div>`;
    } else if(kind === "digital"){
      stats = `
        <div class="cell"><div class="k">Operator</div><div class="v" style="font-size:12px">${escapeHtml(p.operator || "—")}</div></div>
        <div class="cell"><div class="k">Capacity</div><div class="v">${p.capacity_estimate_mw!=null ? fmtCap(p.capacity_estimate_mw) : "—"}</div></div>
        <div class="cell"><div class="k">Investment</div><div class="v">${fmtInvestment(p.investment_usd)}</div></div>
        <div class="cell"><div class="k">${p.status==="operational"?"Energised":"Target year"}</div><div class="v">${escapeHtml(p.year || "—")}</div></div>`;
    }

    const [lng, lat] = f.geometry.coordinates;
    const coords = `${Math.abs(lat).toFixed(2)}°${lat>=0?"N":"S"}, ${Math.abs(lng).toFixed(2)}°${lng>=0?"E":"W"}`;

    const dotColor = badgeClass==='power'      ? (FUEL_COLOR[p.fuel_type] || FUEL_COLOR.solar)
                   : badgeClass==='industrial' ? INDUSTRIAL_COLOR
                   : badgeClass==='digital'    ? (p.category==='cable_landing' ? CABLE_COLOR : DIGITAL_COLOR)
                   : GRID_COLOR;

    $("#popupBadge").innerHTML = `<span class="badge ${badgeClass}"><span class="dot" style="background:${dotColor}"></span>${badgeLabel}</span>`;
    $("#popupBody").innerHTML = `
      <h1 class="pop-title">${escapeHtml(p.name)}</h1>
      <div class="pop-sub">${escapeHtml(p.region || "")} · ${coords}</div>
      <span class="status-pill ${p.status || 'operational'}"><span class="dot"></span>${escapeHtml(p.status || "operational")}</span>
      <div class="stat-grid">${stats}</div>
      <div class="source-row">
        <span class="src">${escapeHtml(p.source || "—")}</span>
        ${p.source_url ? `<a href="${escapeHtml(p.source_url)}" target="_blank" rel="noopener">source ↗</a>` : ""}
      </div>
      <details>
        <summary>Raw data</summary>
        <pre class="raw-json">${escapeHtml(JSON.stringify(p, null, 2))}</pre>
      </details>
      <div class="pop-actions">
        <a href="mailto:reda.tahiri@example.com?subject=${encodeURIComponent('MoroccoMap — correction: '+p.name)}&body=${encodeURIComponent('Feature id: '+p.id+'\n\nSuggested correction:\n')}">Report an error</a>
        ${p.source_url ? `<a href="${escapeHtml(p.source_url)}" target="_blank" rel="noopener">Primary source ↗</a>` : ""}
      </div>`;
    popup.classList.add("open");
    popup.setAttribute("aria-hidden","false");
  }

  function openLinePopup(f){
    const p = f.properties || {};
    $("#popupBadge").innerHTML = `<span class="badge grid"><span class="dot" style="background:${GRID_COLOR}"></span>Transmission line</span>`;
    $("#popupBody").innerHTML = `
      <h1 class="pop-title">${escapeHtml(p.name)}</h1>
      <div class="pop-sub">${p.voltage_kv} kV</div>
      <span class="status-pill ${p.status || 'operational'}"><span class="dot"></span>${escapeHtml(p.status || "operational")}</span>
      <div class="stat-grid">
        <div class="cell"><div class="k">Voltage</div><div class="v">${p.voltage_kv} kV</div></div>
        <div class="cell"><div class="k">Status</div><div class="v" style="text-transform:capitalize">${escapeHtml(p.status)}</div></div>
        <div class="cell"><div class="k">Precision</div><div class="v" style="text-transform:capitalize">${escapeHtml(p.precision || "approximate")}</div></div>
        <div class="cell"><div class="k">Kind</div><div class="v">${p.kind === "hvdc_planned" ? "HVDC (planned)" : "AC"}</div></div>
      </div>
      <div class="source-row">
        <span class="src">${escapeHtml(p.source || "—")}</span>
        ${p.source_url ? `<a href="${escapeHtml(p.source_url)}" target="_blank" rel="noopener">source ↗</a>` : ""}
      </div>
      <details>
        <summary>Raw data</summary>
        <pre class="raw-json">${escapeHtml(JSON.stringify(p, null, 2))}</pre>
      </details>
      <div class="pop-actions">
        <a href="mailto:reda.tahiri@example.com?subject=${encodeURIComponent('MoroccoMap — correction: '+p.name)}">Report an error</a>
      </div>`;
    popup.classList.add("open");
    popup.setAttribute("aria-hidden","false");
  }

  function closePopup(){
    popup.classList.remove("open");
    popup.setAttribute("aria-hidden","true");
  }
  $("#popupClose").addEventListener("click", closePopup);

  // ---------- Country switch ----------
  countrySelect.addEventListener("change", async (e)=>{
    const key = e.target.value;
    if(!ENABLED.includes(key)) return;
    currentCountry = key;
    const c = COUNTRIES[key];
    await loadAllData(key);
    renderLayerList(key);
    renderKPIs(key);
    renderMethodologySources(key);
    if(map){
      map.flyTo({ center: c.center, zoom: c.zoom, speed: 0.8, curve: 1.4 });
      buildMapLayers(key);
    }
  });

  boot();
})();

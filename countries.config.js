// Adding a country to the platform:
//   1. Drop GeoJSON files into  ./data/<key>/
//   2. Add an entry below with center, zoom, label, dataPath
//   3. (optional) add the country key to `enabled` to surface it in the UI
//
// No other code change is required — app.js reads this file at boot.

window.COUNTRIES = {
  morocco: {
    label: "Morocco",
    iso:   "MA",
    center: [-6.3, 31.8],
    zoom:   5.5,
    bounds: [[-17.5, 20.5], [-0.8, 36.35]],
    dataPath: "./data/morocco/",
    layers: [
      { id: "power-plants", file: "power-plants.geojson", kind: "points",
        title: "Power generation",
        source: "Global Energy Monitor · ONEE · operator disclosures",
        sourceUrl: "https://globalenergymonitor.org/projects/global-power-plant-tracker/",
        updated: "2026-04" },
      // Three independent grid sublayers — each toggleable in the sidebar
      { id: "oim-grid", file: null, kind: "oim",
        title: "Grid — OSM / OpenInfraMap (LV + MV)",
        source: "OpenStreetMap contributors · OpenInfraMap (ODbL)",
        sourceUrl: "https://openinframap.org/",
        updated: "live" },
      { id: "interconnectors", file: "interconnectors.geojson", kind: "lines",
        title: "Grid — Interconnectors (HV, operational / idle)",
        source: "REE · ONEE · editorial overlay on OpenInfraMap",
        sourceUrl: "https://openinframap.org/",
        updated: "2026-04" },
      { id: "planned-corridors", file: "planned-corridors.geojson", kind: "lines",
        title: "Grid — Planned corridors (HVDC, WBG 2018)",
        source: "Xlinks · MIICEN · World Bank Group 2018 masterplan",
        sourceUrl: "https://datacatalog.worldbank.org/",
        updated: "2026-04" },
      { id: "national-hv", file: "national-hv.geojson", kind: "lines",
        title: "Grid — National HV (ONEE 60 / 225 / 400 kV)",
        source: "ONEE shapefile · derived 2026 (947 lines)",
        sourceUrl: "https://www.one.org.ma/",
        updated: "2026-05" },
      { id: "industrial", file: "industrial.geojson", kind: "points",
        title: "Industrial consumers",
        source: "OCP · Holcim · SONASID · Renault · public disclosures",
        sourceUrl: "https://www.ocpgroup.ma/",
        updated: "2026-04" },
      { id: "digital", file: "digital.geojson", kind: "points",
        title: "Digital infrastructure",
        source: "Datacentermap.com · OSM · press releases",
        sourceUrl: "https://www.datacentermap.com/morocco/",
        updated: "2026-03" }
    ]
  },

  // Reserved — no data in v1, will no-op until GeoJSON files are dropped in.
  egypt:   { label: "Egypt",   iso: "EG", center: [30.8, 26.8], zoom: 5.2,
             dataPath: "./data/egypt/",   layers: [], placeholder: true },
  senegal: { label: "Senegal", iso: "SN", center: [-14.4, 14.5], zoom: 6.2,
             dataPath: "./data/senegal/", layers: [], placeholder: true },
  namibia: { label: "Namibia", iso: "NA", center: [17.5, -22.5], zoom: 5.2,
             dataPath: "./data/namibia/", layers: [], placeholder: true }
};

window.COUNTRIES_ENABLED = ["morocco"];

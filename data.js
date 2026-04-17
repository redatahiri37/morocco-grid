// Morocco geographic bounds
const MOROCCO_BOUNDS = {
  minLat: 27.66,
  maxLat: 35.92,
  minLon: -13.17,
  maxLon: -1.01,
};

const CITIES = [
  { name: 'Casablanca', lat: 33.57, lon: -7.59, pop: 3.75 },
  { name: 'Rabat', lat: 34.02, lon: -6.83, pop: 0.58 },
  { name: 'Fès', lat: 34.04, lon: -5.00, pop: 1.15 },
  { name: 'Marrakech', lat: 31.63, lon: -8.00, pop: 0.93 },
  { name: 'Tangier', lat: 35.77, lon: -5.80, pop: 0.97 },
  { name: 'Meknès', lat: 33.88, lon: -5.55, pop: 0.63 },
  { name: 'Agadir', lat: 30.43, lon: -9.60, pop: 0.42 },
  { name: 'Oujda', lat: 34.68, lon: -1.90, pop: 0.40 },
  { name: 'Kenitra', lat: 34.26, lon: -6.58, pop: 0.43 },
  { name: 'Tetouan', lat: 35.58, lon: -5.37, pop: 0.38 },
  { name: 'Safi', lat: 32.28, lon: -9.24, pop: 0.31 },
  { name: 'El Jadida', lat: 33.25, lon: -8.51, pop: 0.19 },
  { name: 'Beni Mellal', lat: 32.34, lon: -6.35, pop: 0.19 },
  { name: 'Nador', lat: 35.17, lon: -2.93, pop: 0.17 },
  { name: 'Taza', lat: 34.21, lon: -4.01, pop: 0.14 },
  { name: 'Ouarzazate', lat: 30.93, lon: -6.90, pop: 0.07 },
  { name: 'Dakhla', lat: 23.71, lon: -15.94, pop: 0.05 },
  { name: 'Laayoune', lat: 27.15, lon: -13.20, pop: 0.22 },
  { name: 'Essaouira', lat: 31.51, lon: -9.76, pop: 0.08 },
  { name: 'Errachidia', lat: 31.92, lon: -4.43, pop: 0.09 },
];

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function generateGridData(gridSize) {
  const cells = [];
  const { minLat, maxLat, minLon, maxLon } = MOROCCO_BOUNDS;

  // Precompute mountain reference points
  const highAtlas = { lat: 31.5, lon: -6.5 };
  const midAtlas = { lat: 33.2, lon: -4.5 };
  const antiAtlas = { lat: 30.0, lon: -7.0 };
  const rif = { lat: 35.0, lon: -4.5 };

  for (let lat = minLat; lat < maxLat; lat += gridSize) {
    for (let lon = minLon; lon < maxLon; lon += gridSize) {
      const cLat = lat + gridSize / 2;
      const cLon = lon + gridSize / 2;

      // --- Population density (people/km²) ---
      let population = 3;
      for (const city of CITIES) {
        const d = haversineKm(cLat, cLon, city.lat, city.lon);
        population += city.pop * 1200 * Math.exp(-d / 55);
      }
      if (cLat < 29) {
        population *= Math.max(0.015, (cLat - 27) / 25);
      }
      population = Math.round(Math.min(population, 16000));

      // --- Elevation (meters) ---
      const dHighAtlas = haversineKm(cLat, cLon, highAtlas.lat, highAtlas.lon);
      const dMidAtlas = haversineKm(cLat, cLon, midAtlas.lat, midAtlas.lon);
      const dAntiAtlas = haversineKm(cLat, cLon, antiAtlas.lat, antiAtlas.lon);
      const dRif = haversineKm(cLat, cLon, rif.lat, rif.lon);

      let elevation = 180;
      elevation += Math.max(0, 3200 * Math.exp(-dHighAtlas / 75));
      elevation += Math.max(0, 1900 * Math.exp(-dMidAtlas / 65));
      elevation += Math.max(0, 1300 * Math.exp(-dAntiAtlas / 70));
      elevation += Math.max(0, 1600 * Math.exp(-dRif / 50));
      elevation = Math.round(Math.max(0, Math.min(elevation, 4200)));

      // --- Temperature (°C annual mean) ---
      let temperature = 28 - (cLat - 27) * 0.55;
      temperature -= elevation * 0.0065;
      temperature += Math.max(0, (29 - cLat) * 0.85);
      const distAtlantic = Math.abs(cLon - -13.17) * 111;
      temperature -= Math.min(2.5, distAtlantic / 220);
      temperature = Math.round(Math.max(8, Math.min(40, temperature)) * 10) / 10;

      // --- Annual rainfall (mm) ---
      let rainfall;
      if (cLat > 33) {
        rainfall = 480 + (cLat - 33) * 110 + Math.max(0, 850 * Math.exp(-dRif / 75));
      } else if (cLat > 30) {
        rainfall =
          190 +
          (cLat - 30) * 95 +
          Math.max(0, 420 * Math.exp(-dHighAtlas / 65)) +
          Math.max(0, 280 * Math.exp(-dMidAtlas / 60));
      } else {
        rainfall = Math.max(15, (cLat - 27) * 28);
      }
      if (cLat < 29) rainfall = Math.max(12, rainfall * 0.28);
      rainfall = Math.round(Math.max(12, Math.min(1300, rainfall)));

      cells.push({
        lat,
        lon,
        centerLat: cLat,
        centerLon: cLon,
        gridSize,
        data: { population, elevation, temperature, rainfall },
      });
    }
  }
  return cells;
}

const LAYER_CONFIG = {
  population: {
    label: 'Population Density',
    unit: 'people/km²',
    colors: ['#f7fbff', '#c6dbef', '#9ecae1', '#4292c6', '#2171b5', '#08519c', '#08306b'],
    thresholds: [0, 10, 50, 200, 500, 1000, 5000],
    format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`),
  },
  elevation: {
    label: 'Elevation',
    unit: 'meters',
    colors: ['#006837', '#31a354', '#78c679', '#ffffcc', '#fd8d3c', '#e31a1c', '#67000d'],
    thresholds: [0, 300, 700, 1200, 1800, 2500, 3200],
    format: (v) => `${v}m`,
  },
  temperature: {
    label: 'Annual Avg Temperature',
    unit: '°C',
    colors: ['#4575b4', '#74add1', '#abd9e9', '#fee090', '#fdae61', '#f46d43', '#d73027'],
    thresholds: [8, 12, 16, 20, 24, 28, 32],
    format: (v) => `${v}°C`,
  },
  rainfall: {
    label: 'Annual Rainfall',
    unit: 'mm/year',
    colors: ['#ffffd4', '#fee391', '#fec44f', '#41b6c4', '#1d91c0', '#225ea8'],
    thresholds: [0, 60, 120, 300, 600, 900],
    format: (v) => `${v}mm`,
  },
};

function getColor(value, layer) {
  const { thresholds, colors } = LAYER_CONFIG[layer];
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (value >= thresholds[i]) return colors[Math.min(i, colors.length - 1)];
  }
  return colors[0];
}

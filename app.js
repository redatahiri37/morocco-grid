'use strict';

class MoroccoGridApp {
  constructor() {
    this.map = null;
    this.lightTiles = null;
    this.darkTiles = null;
    this.gridLayer = null;
    this.cityLayer = null;
    this.cells = [];
    this.currentLayer = 'population';
    this.currentGridSize = 0.5;
    this.fillOpacity = 0.72;
    this.isDark = true;
    this._selectedRect = null;
    this._selectedCell = null;

    this._initMap();
    this._addCityMarkers();
    this._bindControls();
    this._loadGrid();
  }

  // ── Map setup ──────────────────────────────────────────────

  _initMap() {
    this.map = L.map('map', {
      center: [31.8, -7.2],
      zoom: 5,
      minZoom: 4,
      maxZoom: 12,
      zoomControl: true,
    });

    this.lightTiles = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 }
    );

    this.darkTiles = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>', maxZoom: 19 }
    );

    this.darkTiles.addTo(this.map);

    // Suppress tooltip when mouse leaves map
    this.map.getContainer().addEventListener('mouseleave', () => this._hideTooltip());
  }

  _addCityMarkers() {
    this.cityLayer = L.layerGroup();

    for (const city of CITIES) {
      const radius = 3 + city.pop * 2.2;
      const marker = L.circleMarker([city.lat, city.lon], {
        radius: Math.min(radius, 12),
        color: '#fff',
        weight: 1.5,
        fillColor: '#C1272D',
        fillOpacity: 0.9,
      }).bindTooltip(city.name, { permanent: false, direction: 'top', className: 'city-label' });

      this.cityLayer.addLayer(marker);
    }

    this.cityLayer.addTo(this.map);
  }

  // ── Grid ───────────────────────────────────────────────────

  _loadGrid() {
    const overlay = document.getElementById('loading');
    overlay.classList.remove('hidden');

    // Defer so the DOM can render the spinner first
    setTimeout(() => {
      this.cells = generateGridData(this.currentGridSize);
      this._renderGrid();
      this._updateStats();
      overlay.classList.add('hidden');
    }, 30);
  }

  _renderGrid() {
    if (this.gridLayer) {
      this.map.removeLayer(this.gridLayer);
    }

    this.gridLayer = L.layerGroup();
    const borderColor = this.isDark ? '#33334d' : '#bbbbd4';

    for (const cell of this.cells) {
      const value = cell.data[this.currentLayer];
      const color = getColor(value, this.currentLayer);

      const rect = L.rectangle(
        [[cell.lat, cell.lon], [cell.lat + cell.gridSize, cell.lon + cell.gridSize]],
        {
          color: borderColor,
          weight: 0.4,
          fillColor: color,
          fillOpacity: this.fillOpacity,
          interactive: true,
        }
      );

      rect._cellData = cell;

      rect.on('mouseover', (e) => {
        e.target.setStyle({ fillOpacity: Math.min(1, this.fillOpacity + 0.2), weight: 1.5 });
        e.target.bringToFront();
        this._showTooltip(e, cell);
      });

      rect.on('mouseout', (e) => {
        if (e.target !== this._selectedRect) {
          e.target.setStyle({ fillOpacity: this.fillOpacity, weight: 0.4 });
        }
        this._hideTooltip();
      });

      rect.on('mousemove', (e) => this._moveTooltip(e));

      rect.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        if (this._selectedRect && this._selectedRect !== e.target) {
          this._selectedRect.setStyle({ weight: 0.4 });
        }
        e.target.setStyle({ weight: 2.5, color: '#FFD700' });
        this._selectedRect = e.target;
        this._selectedCell = cell;
        this._updateCellInfo(cell);
      });

      this.gridLayer.addLayer(rect);
    }

    // Cities always on top
    if (this.cityLayer) this.cityLayer.bringToFront();
    this.gridLayer.addTo(this.map);
    if (this.cityLayer) this.cityLayer.bringToFront();
  }

  _refreshOpacity() {
    if (!this.gridLayer) return;
    this.gridLayer.eachLayer((rect) => {
      if (rect !== this._selectedRect) {
        rect.setStyle({ fillOpacity: this.fillOpacity });
      }
    });
  }

  // ── Tooltip ────────────────────────────────────────────────

  _showTooltip(e, cell) {
    const el = document.getElementById('tooltip');
    const cfg = LAYER_CONFIG[this.currentLayer];
    const val = cell.data[this.currentLayer];
    const d = cell.data;

    const ns = cell.centerLat.toFixed(2);
    const ew = Math.abs(cell.centerLon).toFixed(2) + (cell.centerLon < 0 ? '°W' : '°E');

    el.innerHTML = `
      <div class="tt-layer">${cfg.label}</div>
      <div class="tt-value">${cfg.format(val)}</div>
      <div class="tt-coords">${ns}°N &nbsp;${ew}</div>
      <div class="tt-divider"></div>
      <div class="tt-extra">
        <div class="tt-kv"><span class="tt-k">Population</span><span class="tt-v">${LAYER_CONFIG.population.format(d.population)} /km²</span></div>
        <div class="tt-kv"><span class="tt-k">Elevation</span><span class="tt-v">${LAYER_CONFIG.elevation.format(d.elevation)}</span></div>
        <div class="tt-kv"><span class="tt-k">Temperature</span><span class="tt-v">${LAYER_CONFIG.temperature.format(d.temperature)}</span></div>
        <div class="tt-kv"><span class="tt-k">Rainfall</span><span class="tt-v">${LAYER_CONFIG.rainfall.format(d.rainfall)}</span></div>
      </div>
    `;

    el.classList.remove('hidden');
    this._moveTooltip(e);
  }

  _moveTooltip(e) {
    const el = document.getElementById('tooltip');
    if (el.classList.contains('hidden')) return;

    const wrap = document.getElementById('map-wrap');
    const bounds = wrap.getBoundingClientRect();
    const x = e.originalEvent.clientX - bounds.left;
    const y = e.originalEvent.clientY - bounds.top;

    const ttW = el.offsetWidth || 180;
    const ttH = el.offsetHeight || 120;
    const pad = 14;

    const left = (x + pad + ttW > bounds.width) ? x - ttW - pad : x + pad;
    const top  = (y - pad - ttH < 0)            ? y + pad        : y - ttH - pad;

    el.style.left = left + 'px';
    el.style.top  = top  + 'px';
  }

  _hideTooltip() {
    document.getElementById('tooltip').classList.add('hidden');
  }

  // ── Sidebar ────────────────────────────────────────────────

  _updateStats() {
    const values = this.cells.map((c) => c.data[this.currentLayer]);
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const fmt = LAYER_CONFIG[this.currentLayer].format;

    document.getElementById('statCells').textContent = this.cells.length.toLocaleString();
    document.getElementById('statAvg').textContent   = fmt(Math.round(avg));
    document.getElementById('statMax').textContent   = fmt(max);
    document.getElementById('statMin').textContent   = fmt(min);

    this._updateLegend();
  }

  _updateLegend() {
    const cfg = LAYER_CONFIG[this.currentLayer];
    const el = document.getElementById('legend');

    el.innerHTML = cfg.thresholds
      .map((t, i) => {
        const nextT = cfg.thresholds[i + 1];
        const range = nextT !== undefined ? `${cfg.format(t)} – ${cfg.format(nextT)}` : `≥ ${cfg.format(t)}`;
        return `
          <div class="legend-row">
            <span class="legend-swatch" style="background:${cfg.colors[Math.min(i, cfg.colors.length - 1)]}"></span>
            <span class="legend-range">${range}</span>
          </div>`;
      })
      .join('');
  }

  _updateCellInfo(cell) {
    const el = document.getElementById('cellInfo');
    const d  = cell.data;
    const latStr = `${cell.centerLat.toFixed(2)}°N`;
    const lonStr = `${Math.abs(cell.centerLon).toFixed(2)}°${cell.centerLon < 0 ? 'W' : 'E'}`;

    const rows = [
      ['Location',   `${latStr}, ${lonStr}`],
      ['Population', `${LAYER_CONFIG.population.format(d.population)} /km²`],
      ['Elevation',  LAYER_CONFIG.elevation.format(d.elevation)],
      ['Temperature',LAYER_CONFIG.temperature.format(d.temperature)],
      ['Rainfall',   LAYER_CONFIG.rainfall.format(d.rainfall)],
    ];

    el.innerHTML = rows
      .map(([k, v]) => `<div class="cell-row"><span class="cell-key">${k}</span><span class="cell-val">${v}</span></div>`)
      .join('');
  }

  // ── Controls ───────────────────────────────────────────────

  _bindControls() {
    document.getElementById('layerSelect').addEventListener('change', (e) => {
      this.currentLayer = e.target.value;
      this._renderGrid();
      this._updateStats();
      if (this._selectedCell) this._updateCellInfo(this._selectedCell);
    });

    document.getElementById('gridSizeSelect').addEventListener('change', (e) => {
      this.currentGridSize = parseFloat(e.target.value);
      this._selectedRect = null;
      this._selectedCell = null;
      document.getElementById('cellInfo').innerHTML = '<p class="hint-text">Click a grid cell to inspect it</p>';
      this._loadGrid();
    });

    document.getElementById('opacitySlider').addEventListener('input', (e) => {
      this.fillOpacity = parseFloat(e.target.value);
      this._refreshOpacity();
    });

    document.getElementById('themeToggle').addEventListener('click', () => {
      this.isDark = !this.isDark;
      this._applyTheme();
    });

    // Deselect when clicking empty map
    this.map.on('click', () => {
      if (this._selectedRect) {
        this._selectedRect.setStyle({ weight: 0.4, color: this.isDark ? '#33334d' : '#bbbbd4' });
        this._selectedRect = null;
        this._selectedCell = null;
        document.getElementById('cellInfo').innerHTML = '<p class="hint-text">Click a grid cell to inspect it</p>';
      }
    });
  }

  _applyTheme() {
    const body = document.body;

    if (this.isDark) {
      body.classList.remove('light');
      body.classList.add('dark');
      this.map.removeLayer(this.lightTiles);
      this.darkTiles.addTo(this.map);
      document.getElementById('iconSun').style.display  = '';
      document.getElementById('iconMoon').style.display = 'none';
    } else {
      body.classList.remove('dark');
      body.classList.add('light');
      this.map.removeLayer(this.darkTiles);
      this.lightTiles.addTo(this.map);
      document.getElementById('iconSun').style.display  = 'none';
      document.getElementById('iconMoon').style.display = '';
    }

    // Re-render to update border colors
    this._renderGrid();
  }
}

// ── Boot ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => new MoroccoGridApp());

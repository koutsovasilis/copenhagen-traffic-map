import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import * as turf from '@turf/turf';

// --- INITIALIZE MAP ---
const map = L.map('map', {
  zoomControl: false 
}).setView([55.6761, 12.5683], 12);

L.control.zoom({ position: 'topright' }).addTo(map);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

// --- GLOBAL VARIABLES ---
let globalGeoData = null;
let neighborhoodLayers = {}; 
let searchMarker = null; 
let infoMarker = null; 

const stationLayer = L.layerGroup();
const busyRoadLayer = L.layerGroup().addTo(map); 


const neighborhoodUrl = "/data/neighborhoods.json";
const trafficUrl = "/data/traffic_data.json";
// --- HELPERS ---
function resetNeighborhoods() {
  Object.values(neighborhoodLayers).forEach(layer => {
    layer.fire('resetStyle');
  });
  if (infoMarker) {
    map.removeLayer(infoMarker);
    infoMarker = null;
  }
}

function createPointPopup(data, title, themeColor) {
  const truckCount = Math.round(data.aadt * (data.truck_pct / 100));
  const cleanTruckPct = data.truck_pct.toFixed(1);
  const cleanCargoPct = data.cargo_pct.toFixed(1);
  return `<div style="min-width: 240px; font-family: sans-serif;"><div style="background:${themeColor}; color:white; padding:5px 10px; margin:-10px -10px 10px -10px; border-radius:4px 4px 0 0; font-size:10px; font-weight:bold; text-transform:uppercase;">📍 ${title} | ${data.year}</div><div style="margin-top:10px;"><b style="font-size: 14px; color:#2c3e50;">${data.street}</b><br><small style="color:#7f8c8d;">${data.desc || 'No description'}</small></div><hr style="border:0; border-top:1px solid #eee; margin:10px 0;"><table style="width:100%; font-size: 12px;"><tr><td><b>Daily Motor:</b></td><td style="text-align:right"><b>${data.aadt.toLocaleString()}</b></td></tr><tr style="color:#e67e22;"><td>↳ Trucks:</td><td style="text-align:right">${truckCount.toLocaleString()} (${cleanTruckPct}%)</td></tr><tr><td><b>Daily Bikes:</b></td><td style="text-align:right"><b>${data.bikes.toLocaleString()}</b></td></tr><tr style="color:#27ae60;"><td>↳ Cargo:</td><td style="text-align:right">${cleanCargoPct}%</td></tr></table>${data.report ? `<a href="${data.report}" target="_blank" style="display:block; margin-top:10px; font-size:11px; color:#3498db; font-weight:bold; text-decoration:none;">PDF Report (Census ${data.year}) →</a>` : ''}</div>`;
}

// --- DATA FETCHING & RENDERING ---
async function fetchAllData() {
  try {
    const [geoRes, trafficRes] = await Promise.all([fetch(neighborhoodUrl), fetch(trafficUrl)]);
    globalGeoData = await geoRes.json();
    const trafficResult = await trafficRes.json();
    const records = trafficResult.result.records;

    const trafficPoints = records.map(p => {
      const coords = p.wkb_geometry.match(/(-?\d+\.\d+)/g);
      const aadt = parseInt(p.aadt_koretojer) || 0;
      const bikes = parseInt(p.aadt_cykler) || 0;
      if (!coords || (aadt === 0 && bikes === 0)) return null;
      return turf.point([parseFloat(coords[0]), parseFloat(coords[1])], {
        id: p.t_nr, street: p.vejnavn || "Unknown Street", desc: p.beskrivelse || "",
        aadt: aadt, hvdt: parseInt(p.hvdt_koretojer) || 0,
        truck_pct: parseFloat(p.tung_pct_real) || 0,
        bikes: bikes, cargo_pct: parseFloat(p.ladcykler_pct_real) || 0,
        year: parseInt(p.aar) || 0, report: p.link || null
      });
    }).filter(p => p !== null);

    const trafficFeatureCollection = turf.featureCollection(trafficPoints);

    // Υπολογισμός Scores με Buffer 50 μέτρων για τους οριακούς σταθμούς
    const neighborhoodsWithScores = globalGeoData.features.map(feature => {
      // Δημιουργούμε ένα μικρό buffer 50 μέτρων γύρω από τη γειτονιά για να "πιάσουμε" τους σταθμούς στα σύνορα
      const bufferedNeighborhood = turf.buffer(feature, 0.05, { units: 'kilometers' });
      const ptsWithin = turf.pointsWithinPolygon(trafficFeatureCollection, bufferedNeighborhood);

      let score = null;
      if (ptsWithin.features.length > 0) {
        const totalImpact = ptsWithin.features.reduce((acc, pt) => {
          const { aadt, bikes, truck_pct } = pt.properties;
          const t_ratio = truck_pct / 100;
          // Impact Formula: (Cars * 1) + (Trucks * 10) + (Bikes * 0.2)
          return acc + (aadt * (1 - t_ratio)) + (aadt * t_ratio * 10) + (bikes * 0.2);
        }, 0);

        const areaKm2 = turf.area(feature) / 1_000_000;
        const avgImpact = totalImpact / ptsWithin.features.length; // Μέσος όρος ανά σταθμό
score = avgImpact / areaKm2; // Εξομάλυνση βάσει εμβαδού
      }

      return { feature, score };
    });

    const validScores = neighborhoodsWithScores.map(n => n.score).filter(s => s !== null).sort((a, b) => a - b);
    const lowThreshold = validScores[Math.floor(validScores.length * 0.33)];
    const highThreshold = validScores[Math.floor(validScores.length * 0.66)];

    console.log("--- NEIGHBORHOOD DATA GENERATED ---");
    
    L.geoJSON(globalGeoData, {
      style: (feature) => {
        const nData = neighborhoodsWithScores.find(n => n.feature === feature);
        const score = nData ? nData.score : null;
        let fillCol = '#bdc3c7'; 
        if (score !== null) {
          if (score >= highThreshold) fillCol = '#e74c3c';
          else if (score >= lowThreshold) fillCol = '#f1c40f';
          else fillCol = '#2ecc71';
        }
        return { fillColor: fillCol, weight: 1.5, color: 'white', fillOpacity: 0.6 };
      },
      onEachFeature: (feature, layer) => {
        const name = feature.properties.kvarternavn;
        neighborhoodLayers[name] = layer;

        const nData = neighborhoodsWithScores.find(n => n.feature === feature);
        const score = nData ? nData.score : null;
        
        // Για τα στατιστικά του popup, χρησιμοποιούμε τους σταθμούς εντός του buffer
        const bufferedNeighborhood = turf.buffer(feature, 0.05, { units: 'kilometers' });
        const ptsWithin = turf.pointsWithinPolygon(trafficFeatureCollection, bufferedNeighborhood);

        layer.on('mouseover', () => { if (!infoMarker) layer.setStyle({ fillOpacity: 0.8 }); });
        layer.on('mouseout', () => { if (!infoMarker) layer.fire('resetStyle'); });

        layer.on('resetStyle', () => {
          let fillCol = '#bdc3c7'; 
          if (score !== null) {
            if (score >= highThreshold) fillCol = '#e74c3c';
            else if (score >= lowThreshold) fillCol = '#f1c40f';
            else fillCol = '#2ecc71';
          }
          layer.setStyle({ fillColor: fillCol, weight: 1.5, color: 'white', fillOpacity: 0.6 });
        });

        let s = ptsWithin.features.reduce((acc, pt) => {
          acc.aadt += pt.properties.aadt; acc.bikes += pt.properties.bikes;
          acc.trucks += (pt.properties.aadt * (pt.properties.truck_pct / 100));
          acc.cargoBikes += (pt.properties.bikes * (pt.properties.cargo_pct / 100));
          if (pt.properties.year > 0) acc.years.push(pt.properties.year);
          return acc;
        }, { aadt: 0, bikes: 0, trucks: 0, cargoBikes: 0, years: [] });

        const count = ptsWithin.features.length;
        const lastYear = s.years.length > 0 ? Math.max(...s.years) : "N/A";
        const avgTruckPct = s.aadt > 0 ? ((s.trucks / s.aadt) * 100).toFixed(1) : 0;
        const avgCargoPct = s.bikes > 0 ? ((s.cargoBikes / s.bikes) * 100).toFixed(1) : 0;

        let statusText = score >= highThreshold ? "High Impact" : score >= lowThreshold ? "Moderate" : "Low Impact";
        let statusColor = score >= highThreshold ? "#e74c3c" : score >= lowThreshold ? "#f1c40f" : "#2ecc71";

        const popupContent = `
          <div style="min-width: 250px; font-family: sans-serif;">
            <div style="font-size: 9px; text-transform: uppercase; color: #7f8c8d; margin-bottom: 2px; font-weight: bold;">
              📍 Area-wide Statistics
            </div>
            <div style="background:${statusColor}; color:white; padding:4px 10px; border-radius:3px; float:right; font-size:10px; font-weight:bold; margin-top:5px;">
              ${statusText}
            </div>
            <h3 style="margin:0; color: #2c3e50;">${name}</h3>
            
            <div style="font-size: 11px; color: #95a5a6; margin-top: 5px;">
              Based on <b>${count}</b> sensor(s) | Last: <b>${lastYear}</b>
            </div>

            <hr style="border:0; border-top:1px solid #eee; margin:10px 0;">
            
            <table style="width:100%; font-size: 13px;">
              <tr>
                <td style="padding:3px 0;">🚗 <b>Daily Vehicles:</b></td>
                <td style="text-align:right"><b>${Math.round(s.aadt/count || 0).toLocaleString()}</b></td>
              </tr>
              <tr style="color:#666; font-size:11px;">
                <td>↳ Heavy Trucks:</td>
                <td style="text-align:right">${avgTruckPct}%</td>
              </tr>
              <tr>
                <td style="padding:3px 0;">🚲 <b>Daily Bicycles:</b></td>
                <td style="text-align:right"><b>${Math.round(s.bikes/count || 0).toLocaleString()}</b></td>
              </tr>
              <tr style="color:#666; font-size:11px;">
                <td>↳ Cargo Bikes:</td>
                <td style="text-align:right">${avgCargoPct}%</td>
              </tr>
            </table>
            
            <div style="margin-top: 10px; font-size: 10px; color: #7f8c8d; font-style: italic; border-top: 1px dashed #eee; padding-top: 5px;">
              * Averages calculated from all sensors in/near the area.
            </div>
          </div>`;

        layer.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          resetNeighborhoods();
          layer.setStyle({ weight: 4, color: '#3498db', fillOpacity: 0.8 });
          layer.bringToFront();
          const center = layer.getBounds().getCenter();
          map.flyTo(center, map.getZoom() < 14 ? 14 : map.getZoom(), { duration: 0.8 });
          infoMarker = L.marker(center, { icon: L.divIcon({ className: 'custom-div-icon', html: `<div class="info-icon-btn">i</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(map);
          infoMarker.bindPopup(popupContent, { autoPan: true, autoPanPadding: [50, 50] });
          infoMarker.on('popupclose', () => resetNeighborhoods());
        });
      }
    }).addTo(map);

    // Rendering points
    trafficPoints.forEach(pt => {
      const [lng, lat] = pt.geometry.coordinates;
      if (pt.properties.aadt > 15000) {
        L.circleMarker([lat, lng], { radius: 7, fillColor: '#8e44ad', color: '#fff', weight: 2, fillOpacity: 0.95 }).addTo(busyRoadLayer).bindPopup(createPointPopup(pt.properties, "BUSY ROAD", "#8e44ad"));
      } 
      L.circleMarker([lat, lng], { radius: 4, fillColor: '#34495e', color: '#fff', weight: 1, fillOpacity: 0.7 }).addTo(stationLayer).bindPopup(createPointPopup(pt.properties, "TRAFFIC SENSOR", "#34495e"));
    });

    const overlays = { "<b style='color:#8e44ad'>🔥 Busy Roads</b>": busyRoadLayer, "📍 All Stations": stationLayer };
    L.control.layers(null, overlays, { collapsed: false, position: 'topright' }).addTo(map);

    // Legend
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = () => {
      const div = L.DomUtil.create('div', 'legend');
      div.style.background = 'white'; div.style.padding = '12px'; div.style.borderRadius = '8px'; div.style.boxShadow = '0 0 15px rgba(0,0,0,0.2)';
      div.innerHTML = `<h4 style="margin:0 0 8px 0; font-size:14px; border-bottom:1px solid #eee; padding-bottom:4px;">Map Legend</h4><div style="line-height:1.6; font-size:12px;"><i style="background:#2ecc71; width:12px; height:12px; display:inline-block; border-radius:2px;"></i> Low Impact Area<br><i style="background:#f1c40f; width:12px; height:12px; display:inline-block; border-radius:2px;"></i> Moderate Impact<br><i style="background:#e74c3c; width:12px; height:12px; display:inline-block; border-radius:2px;"></i> High Impact Area<br><hr style="margin:8px 0; border:0; border-top:1px solid #eee;"><i style="background:#8e44ad; width:10px; height:10px; border-radius:50%; display:inline-block; border:1px solid #fff;"></i> <b>Busy Road Spot</b></div>`;
      return div;
    };
    legend.addTo(map);
  } catch (err) { console.error("Critical Error:", err); }
}

// --- SEARCH & AUTOCOMPLETE ---
// (Διατηρούνται ως έχουν στον κώδικά σου)
function executeSearch(lat, lon, displayName) {
  const latlng = L.latLng(lat, lon);
  if (searchMarker) map.removeLayer(searchMarker);
  resetNeighborhoods();
  map.flyTo(latlng, 16, { duration: 1.5 });
  const point = turf.point([lon, lat]);
  let neighborhoodFound = null;
  if (globalGeoData) {
    globalGeoData.features.forEach(f => {
      if (turf.booleanPointInPolygon(point, f)) neighborhoodFound = f.properties.kvarternavn; 
    });
  }
  searchMarker = L.marker(latlng).addTo(map);
  if (neighborhoodFound && neighborhoodLayers[neighborhoodFound]) {
    setTimeout(() => { neighborhoodLayers[neighborhoodFound].fire('click'); }, 1500);
  } else {
    searchMarker.bindPopup(`<b>${displayName}</b><br>Outside borders.`).openPopup();
  }
}

async function handleSearch() {
  const query = document.getElementById('addr-input').value;
  if (!query) return;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ", Copenhagen")}&limit=1`);
    const data = await res.json();
    if (data.length > 0) executeSearch(data[0].lat, data[0].lon, data[0].display_name);
    else alert("Address not found.");
  } catch (err) { console.error("Search Error:", err); }
}

const input = document.getElementById('addr-input');
const listContainer = L.DomUtil.create('div', '', document.body);
listContainer.id = 'autocomplete-list';

async function handleAutocomplete() {
  const query = input.value;
  if (query.length < 3) { listContainer.innerHTML = ''; return; }
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&viewbox=12.45,55.73,12.70,55.61&bounded=1&limit=5`);
    const data = await res.json();
    listContainer.innerHTML = '';
    const rect = input.getBoundingClientRect();
    Object.assign(listContainer.style, { top: `${rect.bottom + window.scrollY}px`, left: `${rect.left + window.scrollX}px`, width: `${rect.width}px` });
    data.forEach(place => {
      const item = L.DomUtil.create('div', 'autocomplete-item', listContainer);
      item.innerText = place.display_name.split(',').slice(0, 3).join(',');
      item.onclick = () => {
        input.value = place.display_name;
        listContainer.innerHTML = '';
        executeSearch(place.lat, place.lon, place.display_name);
      };
    });
  } catch (err) { console.error("Autocomplete error", err); }
}

let timeout = null;
input.addEventListener('input', () => {
  clearTimeout(timeout);
  timeout = setTimeout(handleAutocomplete, 300);
});

document.addEventListener('click', (e) => { if (e.target !== input) listContainer.innerHTML = ''; });
document.getElementById('search-btn').addEventListener('click', handleSearch);
input.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleSearch(); });

fetchAllData();
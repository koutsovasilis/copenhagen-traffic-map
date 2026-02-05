// build-data.js
import fs from 'fs';

import * as turf from '@turf/turf';

const neighborhoodUrl = "https://wfs-kbhkort.kk.dk/k101/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=k101:kvarter&outputFormat=json&SRSNAME=EPSG:4326";
const trafficUrl = "https://admin.opendata.dk/api/3/action/datastore_search?resource_id=50f7a383-653a-4860-bb4e-306f221a2d2a&limit=2000";

async function build() {
    console.log("⏳ Ξεκινάω το τράβηγμα των δεδομένων...");
    const [geoRes, trafficRes] = await Promise.all([fetch(neighborhoodUrl), fetch(trafficUrl)]);
    const globalGeoData = await geoRes.json();
    const trafficResult = await trafficRes.json();
    const records = trafficResult.result.records;

    // 1. Μετατροπή των records σε Turf Points
    const trafficPoints = records.map(p => {
        const coords = p.wkb_geometry.match(/(-?\d+\.\d+)/g);
        if (!coords) return null;
        return turf.point([parseFloat(coords[0]), parseFloat(coords[1])], {
            id: p.t_nr, street: p.vejnavn, aadt: parseInt(p.aadt_koretojer) || 0,
            truck_pct: parseFloat(p.tung_pct_real) || 0, bikes: parseInt(p.aadt_cykler) || 0,
            cargo_pct: parseFloat(p.ladcykler_pct_real) || 0, year: parseInt(p.aar) || 0
        });
    }).filter(p => p !== null);

    const trafficFeatureCollection = turf.featureCollection(trafficPoints);

    // 2. Υπολογισμός Scores για κάθε γειτονιά
    const neighborhoodsWithScores = globalGeoData.features.map(feature => {
        const ptsWithin = turf.pointsWithinPolygon(trafficFeatureCollection, feature);
        let score = null;
        if (ptsWithin.features.length > 0) {
            const totalImpact = ptsWithin.features.reduce((acc, pt) => {
                const { aadt, bikes, truck_pct } = pt.properties;
                return acc + ((aadt * (1 - truck_pct)) + (aadt * truck_pct * 10) + (bikes * 0.2));
            }, 0);
            score = totalImpact / ptsWithin.features.length;
        }
        return { feature, score };
    });

    // 3. Αποθήκευση στο public/data.json
    const finalOutput = {
        neighborhoods: neighborhoodsWithScores,
        stations: trafficPoints, // Εδώ σώζουμε και τους σταθμούς!
        updatedAt: new Date().toISOString()
    };

    fs.writeFileSync('./public/data.json', JSON.stringify(finalOutput));
    console.log("✅ Το data.json δημιουργήθηκε με επιτυχία στο φάκελο public!");
}

build();
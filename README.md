# 📊 Copenhagen Traffic Impact Analyzer (GIS)

An interactive geospatial analysis (GIS) tool that visualizes traffic load across Copenhagen's neighborhoods. It processes raw traffic sensor data to calculate a weighted "Impact Score" for every district.

## 🌐 Live Demo
Check out the live application here: [[(CPH Traffic Map)](https://copenhagen-traffic-map.vercel.app/)]

## 🚀 Key Features
- Interactive Heatmap: Neighborhoods are color-coded based on their traffic intensity (Low, Moderate, High Impact).
- Spatial Analysis: Powered by Turf.js, calculating points within polygons using a 50-meter safety buffer to include border-road sensors.
- Smart Search: Address search functionality (via Nominatim API) that automatically flies to and highlights the corresponding neighborhood.
- Detailed Analytics: Custom popups providing statistics on average daily motor vehicles, heavy trucks, and cargo bikes per area.
- Busy Road Markers: Visual highlighting for specific sensor locations exceeding 15,000 vehicles per day.

## 🧮 Calculation Methodology
The Impact Score is calculated using a weighted formula to reflect actual urban disturbance:
Vehicle Weighting:
🚗 Passenger Cars: 1.0
🚛 Heavy Trucks: 10.0 (due to noise and air quality impact)
🚲 Bicycles: 0.2

Normalization:
- The system calculates the average impact per sensor within the neighborhood.
- The result is divided by the neighborhood area ($km^2$) to determine the final density score.
- This ensures that neighborhoods are compared fairly, regardless of their size or the number of sensors installed.

## 🛠 Tech Stack
Leaflet.js: For interactive mapping and tiling.
Turf.js: For advanced geospatial calculations (Buffers, Point-in-Polygon).
Vite: Frontend tooling and build pipeline.
OpenStreetMap: Map data source.
Open Data DK: Source for raw traffic census data.

## ⚖️ Disclaimer
* **Data Accuracy:** This application is for informational and educational purposes only. While it uses official data from Open Data DK, the "Impact Score" is a custom-calculated index and should not be used for official urban planning or environmental assessment.
* **No Liability:** The author is not responsible for any decisions made based on the data presented in this map. Traffic conditions can change, and sensor data may be subject to periodic maintenance or reporting delays by the municipality.
* **Accuracy:** Neighborhood boundaries and sensor placements are approximations based on the provided GeoJSON and WKB geometries.

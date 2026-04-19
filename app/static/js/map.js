const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {},
        layers: [
            {
                id: 'background',
                type: 'background',
                paint: { 'background-color': '#0f1118' }
            }
        ]
    },
    center: [5.724, 45.188],
    zoom: 9
});

map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

map.on('load', async () => {
    console.log('MapLibre chargé — DynEco');

    // Chargement EPCI et communes
    const [epcisRes, communesRes] = await Promise.all([
        fetch('/api/epcis'),
        fetch('/api/communes')
    ]);
    const epcisData = await epcisRes.json();
    const communesData = await communesRes.json();

    // --- COMMUNES ---
    map.addSource('communes', {
        type: 'geojson',
        data: communesData
    });

    // Fond communes (choroplèthe - neutre pour l'instant)
    map.addLayer({
        id: 'communes-fill',
        type: 'fill',
        source: 'communes',
        paint: {
            'fill-color': '#1e2a3a',
            'fill-opacity': 0.8
        }
    });

    // Contours communes
    map.addLayer({
        id: 'communes-stroke',
        type: 'line',
        source: 'communes',
        paint: {
            'line-color': '#2e4a6a',
            'line-width': 0.5
        }
    });

    // --- EPCI ---
    map.addSource('epcis', {
        type: 'geojson',
        data: epcisData
    });

    // Contours EPCI (plus épais)
    map.addLayer({
        id: 'epcis-stroke',
        type: 'line',
        source: 'epcis',
        paint: {
            'line-color': '#4a90d9',
            'line-width': 2,
            'line-opacity': 0.9
        }
    });

    // --- INTERACTIONS ---

    // Hover commune
    let hoveredCommune = null;

    map.on('mousemove', 'communes-fill', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        if (e.features.length > 0) {
            if (hoveredCommune !== null) {
                map.setFeatureState({ source: 'communes', id: hoveredCommune }, { hover: false });
            }
            hoveredCommune = e.features[0].id;
            map.setFeatureState({ source: 'communes', id: hoveredCommune }, { hover: true });

            // Tooltip
            const props = e.features[0].properties;
            showTooltip(e.lngLat, `<strong>${props.nom_commune}</strong><br>${props.nom_epci}`);
        }
    });

    map.on('mouseleave', 'communes-fill', () => {
        map.getCanvas().style.cursor = '';
        if (hoveredCommune !== null) {
            map.setFeatureState({ source: 'communes', id: hoveredCommune }, { hover: false });
        }
        hoveredCommune = null;
        hideTooltip();
    });

    // Remplir le select EPCI dans les filtres
    const selectEpci = document.getElementById('filtre-epci');
    epcisData.features.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.properties.code_epci;
        opt.textContent = f.properties.nom_epci;
        selectEpci.appendChild(opt);
    });

    console.log(`Carte chargée : ${communesData.features.length} communes, ${epcisData.features.length} EPCI`);
});

// --- TOOLTIP ---
const tooltip = document.createElement('div');
tooltip.id = 'map-tooltip';
document.body.appendChild(tooltip);

function showTooltip(lngLat, html) {
    const point = map.project(lngLat);
    tooltip.innerHTML = html;
    tooltip.style.display = 'block';
    tooltip.style.left = (point.x + 12) + 'px';
    tooltip.style.top = (point.y - 10) + 'px';
}

function hideTooltip() {
    tooltip.style.display = 'none';
}

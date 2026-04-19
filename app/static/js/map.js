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
    center: [5.724, 45.188], // Grenoble
    zoom: 9
});

map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

map.on('load', () => {
    console.log('MapLibre chargé — DynEco prêt');
});

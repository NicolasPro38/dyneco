// Palette couleurs par section NAF
const COULEURS_NAF = {
    'A': '#4CAF50', 'B': '#795548', 'C': '#FF5722',
    'D': '#FF9800', 'E': '#00BCD4', 'F': '#FF6F00',
    'G': '#2196F3', 'H': '#9C27B0', 'I': '#E91E63',
    'J': '#00E5FF', 'K': '#FFC107', 'L': '#607D8B',
    'M': '#3F51B5', 'N': '#8BC34A', 'O': '#F44336',
    'P': '#009688', 'Q': '#4CAF50', 'R': '#FF4081',
    'S': '#FFEB3B', 'T': '#9E9E9E', 'U': '#BDBDBD'
};

const COULEURS_ETAT = {
    'A': '#4CAF50',  // actif - vert
    'F': '#F44336'   // fermé - rouge
};

const COULEURS_EFFECTIF = {
    'Etablissement non employeur': '#607D8B',
    '1 ou 2 salariés': '#4CAF50',
    '3 à 5 salariés': '#8BC34A',
    '6 à 9 salariés': '#FFC107',
    '10 à 19 salariés': '#FF9800',
    '20 à 49 salariés': '#FF5722',
    '50 à 99 salariés': '#F44336',
    '100 à 199 salariés': '#9C27B0',
    '200 à 249 salariés': '#673AB7',
    '250 à 499 salariés': '#3F51B5',
    '500 à 999 salariés': '#1A237E',
};

let modeColor = 'etat_admin';
let etablissementsData = null;

const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {},
        layers: [{
            id: 'background',
            type: 'background',
            paint: { 'background-color': '#0f1118' }
        }]
    },
    center: [5.724, 45.188],
    zoom: 9
});

map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

map.on('load', async () => {
    const [epcisRes, communesRes, sectionsRes] = await Promise.all([
        fetch('/api/epcis'),
        fetch('/api/communes'),
        fetch('/api/sections_naf')
    ]);
    const epcisData = await epcisRes.json();
    const communesData = await communesRes.json();
    const sectionsNaf = await sectionsRes.json();

    // --- COMMUNES ---
    map.addSource('communes', { type: 'geojson', data: communesData });
    map.addLayer({
        id: 'communes-fill',
        type: 'fill',
        source: 'communes',
        paint: { 'fill-color': '#1e2a3a', 'fill-opacity': 0.8 }
    });
    map.addLayer({
        id: 'communes-stroke',
        type: 'line',
        source: 'communes',
        paint: { 'line-color': '#2e4a6a', 'line-width': 0.5 }
    });

    // --- EPCI ---
    map.addSource('epcis', { type: 'geojson', data: epcisData });
    map.addLayer({
        id: 'epcis-stroke',
        type: 'line',
        source: 'epcis',
        paint: { 'line-color': '#4a90d9', 'line-width': 2, 'line-opacity': 0.9 }
    });

    // --- ETABLISSEMENTS (source vide au départ) ---
    map.addSource('etablissements', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
        id: 'etablissements-points',
        type: 'circle',
        source: 'etablissements',
        paint: {
            'circle-radius': [
                'interpolate', ['linear'], ['zoom'],
                8, 2,
                12, 5,
                15, 8
            ],
            'circle-color': '#4a90d9',
            'circle-opacity': 0.85,
            'circle-stroke-width': 0.5,
            'circle-stroke-color': '#ffffff'
        }
    });

    // --- INTERACTIONS ETABLISSEMENTS ---
    const popup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        maxWidth: '320px'
    });

    map.on('click', 'etablissements-points', (e) => {
        const p = e.features[0].properties;
        const etatLabel = p.etat_admin === 'A' ? '🟢 Actif' : '🔴 Fermé';
        const creation = p.date_creation ? p.date_creation.substring(0, 10) : 'N/R';
        const fermeture = p.date_fermeture ? p.date_fermeture.substring(0, 10) : '—';

        popup.setLngLat(e.lngLat).setHTML(`
            <div class="popup-content">
                <div class="popup-titre">${p.nom}</div>
                <div class="popup-etat">${etatLabel}</div>
                <div class="popup-ligne">${p.adresse}</div>
                <div class="popup-ligne"><strong>Activité :</strong> ${p.libelle_naf || p.code_naf || 'N/R'}</div>
                <div class="popup-ligne"><strong>Effectif :</strong> ${p.tranche_effectif || 'N/R'}</div>
                <div class="popup-ligne"><strong>Création :</strong> ${creation}</div>
                <div class="popup-ligne"><strong>Fermeture :</strong> ${fermeture}</div>
                <div class="popup-ligne"><strong>SIRET :</strong> ${p.siret}</div>
            </div>
        `).addTo(map);
    });

    map.on('mouseenter', 'etablissements-points', () => {
        map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'etablissements-points', () => {
        map.getCanvas().style.cursor = '';
    });

    // --- HOVER COMMUNES ---
    map.on('mousemove', 'communes-fill', (e) => {
        if (e.features.length > 0) {
            const props = e.features[0].properties;
            showTooltip(e.lngLat, `<strong>${props.nom_commune}</strong><br>${props.nom_epci}`);
        }
    });
    map.on('mouseleave', 'communes-fill', hideTooltip);

    // --- REMPLIR SELECTS ---
    const selectEpci = document.getElementById('filtre-epci');
    epcisData.features.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.properties.code_epci;
        opt.textContent = f.properties.nom_epci;
        selectEpci.appendChild(opt);
    });

    const selectNaf = document.getElementById('filtre-naf');
    Object.entries(sectionsNaf).forEach(([code, libelle]) => {
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = `${code} — ${libelle}`;
        selectNaf.appendChild(opt);
    });

    // --- BOUTON APPLIQUER ---
    document.getElementById('btn-appliquer').addEventListener('click', chargerEtablissements);

    // Chargement initial
    chargerEtablissements();
});

async function chargerEtablissements() {
    const btn = document.getElementById('btn-appliquer');
    btn.textContent = 'Chargement...';
    btn.disabled = true;

    const params = new URLSearchParams();
    const epci = document.getElementById('filtre-epci').value;
    const naf = document.getElementById('filtre-naf').value;
    const anneeDebut = document.getElementById('annee-debut').value;
    const anneeFin = document.getElementById('annee-fin').value;

    // Types d'événements cochés -> état admin
    const checkboxes = document.querySelectorAll('#filtre-evenements input:checked');
    const types = Array.from(checkboxes).map(cb => cb.value);
    if (types.includes('creation') && !types.includes('cessation')) params.set('etat', 'A');
    if (types.includes('cessation') && !types.includes('creation')) params.set('etat', 'F');

    if (epci) params.set('code_epci', epci);
    if (naf) params.set('section_naf', naf);
    if (anneeDebut) params.set('annee_debut', anneeDebut);
    if (anneeFin) params.set('annee_fin', anneeFin);

    modeColor = document.getElementById('filtre-couleur').value;

    try {
        const res = await fetch(`/api/etablissements?${params}`);
        etablissementsData = await res.json();

        map.getSource('etablissements').setData(etablissementsData);
        appliquerCouleurs();
        mettreAJourCompteur(etablissementsData.total);
    } catch(e) {
        console.error('Erreur chargement établissements:', e);
    }

    btn.textContent = 'Appliquer';
    btn.disabled = false;
}

function appliquerCouleurs() {
    let colorExpr;

    if (modeColor === 'etat_admin') {
        colorExpr = [
            'match', ['get', 'etat_admin'],
            'A', '#4CAF50',
            'F', '#F44336',
            '#999999'
        ];
    } else if (modeColor === 'section_naf') {
        const cases = [];
        Object.entries(COULEURS_NAF).forEach(([k, v]) => {
            cases.push(k, v);
        });
        colorExpr = ['match', ['get', 'section_naf'], ...cases, '#999999'];
    } else if (modeColor === 'tranche_effectif') {
        colorExpr = [
            'match', ['get', 'tranche_effectif'],
            'Etablissement non employeur', '#607D8B',
            '1 ou 2 salariés', '#4CAF50',
            '3 à 5 salariés', '#8BC34A',
            '6 à 9 salariés', '#FFC107',
            '10 à 19 salariés', '#FF9800',
            '20 à 49 salariés', '#FF5722',
            '50 à 99 salariés', '#F44336',
            '100 à 199 salariés', '#9C27B0',
            '#1A237E'
        ];
    } else {
        colorExpr = '#4a90d9';
    }

    map.setPaintProperty('etablissements-points', 'circle-color', colorExpr);
}

function mettreAJourCompteur(total) {
    const el = document.getElementById('analyses-content');
    el.innerHTML = `
        <div class="stat-bloc">
            <div class="stat-valeur">${total.toLocaleString('fr-FR')}</div>
            <div class="stat-label">établissements affichés</div>
        </div>
        <p class="placeholder" style="margin-top:12px">Les graphiques d'analyse arriveront dans la prochaine étape.</p>
    `;
}

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

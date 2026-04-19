const COULEURS_NAF = {
    'A':'#4CAF50','B':'#795548','C':'#FF5722','D':'#FF9800','E':'#00BCD4',
    'F':'#FF6F00','G':'#2196F3','H':'#9C27B0','I':'#E91E63','J':'#00E5FF',
    'K':'#FFC107','L':'#607D8B','M':'#3F51B5','N':'#8BC34A','O':'#F44336',
    'P':'#009688','Q':'#66BB6A','R':'#FF4081','S':'#FFEB3B','T':'#9E9E9E','U':'#BDBDBD'
};

const LABELS_NAF = {
    'A':'Agriculture','B':'Industries extract.','C':'Industrie manuf.',
    'D':'Énergie','E':'Eau/déchets','F':'Construction','G':'Commerce',
    'H':'Transports','I':'Hébergement/restau.','J':'Info/comm.',
    'K':'Finance','L':'Immobilier','M':'Activités spéc.','N':'Services admin.',
    'O':'Admin. publique','P':'Enseignement','Q':'Santé','R':'Arts/loisirs',
    'S':'Autres services','T':'Ménages','U':'Extra-territorial'
};

const COULEURS_EVT = {
    'creation': '#4CAF50',
    'cessation': '#F44336',
    'transfert': '#FF9800',
    'redressement': '#9C27B0',
    'liquidation': '#212121'
};

let modeColor = 'etat_admin';
let modePeriode = 'annee';
let chartEvolution = null;
let chartSecteurs = null;
let chartCommunes = null;
let sectionsNaf = {};
let communesGeoCache = null;
let epcisGeoCache = null;

// --- Gestion mode période ---
function setMode(mode) {
    modePeriode = mode;
    document.getElementById('bloc-periode-annee').style.display = mode === 'annee' ? 'flex' : 'none';
    document.getElementById('bloc-periode-trim').style.display  = mode === 'trimestre' ? 'flex' : 'none';
    document.getElementById('btn-annuel').classList.toggle('active', mode === 'annee');
    document.getElementById('btn-trim').classList.toggle('active', mode === 'trimestre');
}

function getParamsPeriode() {
    const p = { mode: modePeriode };
    if (modePeriode === 'annee') {
        p.annee_debut = document.getElementById('annee-debut').value;
        p.annee_fin   = document.getElementById('annee-fin').value;
    } else {
        p.annee_debut = document.getElementById('annee-debut-trim').value;
        p.annee_fin   = document.getElementById('annee-fin-trim').value;
        p.trim_debut  = document.getElementById('trim-debut').value;
        p.trim_fin    = document.getElementById('trim-fin').value;
    }
    return p;
}

// --- MapLibre ---
const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8, sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#0f1118' } }]
    },
    center: [5.724, 45.188],
    zoom: 9
});

map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

map.on('load', async () => {
    // Charger les bornes de période
    const bornesRes = await fetch('/api/bornes_periode');
    const bornes = await bornesRes.json();

    // Initialiser les valeurs par défaut
    document.getElementById('annee-debut').value      = Math.max(bornes.max_annee - 5, bornes.min_annee);
    document.getElementById('annee-fin').value        = bornes.max_annee;
    document.getElementById('annee-debut-trim').value = Math.max(bornes.max_annee - 2, bornes.min_annee);
    document.getElementById('annee-fin-trim').value   = bornes.max_annee;
    document.getElementById('trim-fin').value         = bornes.max_trim || 4;

    const [epcisRes, communesRes, sectionsRes] = await Promise.all([
        fetch('/api/epcis'), fetch('/api/communes'), fetch('/api/sections_naf')
    ]);
    epcisGeoCache    = await epcisRes.json();
    communesGeoCache = await communesRes.json();
    sectionsNaf      = await sectionsRes.json();

    // Couches carte
    map.addSource('communes', { type: 'geojson', data: communesGeoCache });
    map.addLayer({ id: 'communes-fill', type: 'fill', source: 'communes', paint: { 'fill-color': '#1e2a3a', 'fill-opacity': 0.8 } });
    map.addLayer({ id: 'communes-stroke', type: 'line', source: 'communes', paint: { 'line-color': '#2e4a6a', 'line-width': 0.5 } });

    map.addSource('epcis', { type: 'geojson', data: epcisGeoCache });
    map.addLayer({ id: 'epcis-stroke', type: 'line', source: 'epcis', paint: { 'line-color': '#4a90d9', 'line-width': 2 } });

    map.addSource('etablissements', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
        id: 'etablissements-points', type: 'circle', source: 'etablissements',
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2, 12, 4, 15, 7],
            'circle-color': '#4a90d9',
            'circle-opacity': 0.8,
            'circle-stroke-width': 0.3,
            'circle-stroke-color': '#ffffff'
        }
    });

    // Popup
    const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '320px' });
    map.on('click', 'etablissements-points', (e) => {
        const p = e.features[0].properties;
        const etatLabel = p.etat_admin === 'A' ? '🟢 Actif' : '🔴 Fermé';

        // Contexte période : créé et/ou fermé sur la période ?
        let contexte = '';
        const dateCreation  = p.date_creation  ? p.date_creation.substring(0,10)  : null;
        const dateFermeture = p.date_fermeture ? p.date_fermeture.substring(0,10) : null;

        if (dateCreation && dateFermeture) {
            contexte = `<div class="popup-contexte">⚠️ Créé le ${dateCreation}, fermé le ${dateFermeture}</div>`;
        } else if (dateCreation && p.etat_admin === 'F') {
            contexte = `<div class="popup-contexte">🔴 Créé le ${dateCreation} — fermé depuis</div>`;
        } else if (dateCreation) {
            contexte = `<div class="popup-contexte">🟢 Créé le ${dateCreation} — toujours actif</div>`;
        }

        popup.setLngLat(e.lngLat).setHTML(`
            <div class="popup-content">
                <div class="popup-titre">${p.nom}</div>
                <div class="popup-etat">${etatLabel}</div>
                ${contexte}
                <div class="popup-ligne">${p.adresse || ''}</div>
                <div class="popup-ligne"><strong>Activité :</strong> ${p.libelle_naf || p.code_naf || 'N/R'}</div>
                <div class="popup-ligne"><strong>Effectif :</strong> ${p.tranche_effectif || 'N/R'}</div>
                <div class="popup-ligne"><strong>Commune :</strong> ${p.nom_commune}</div>
                <div class="popup-ligne"><strong>SIRET :</strong> ${p.siret}</div>
            </div>
        `).addTo(map);
    });
    map.on('mouseenter', 'etablissements-points', () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', 'etablissements-points', () => map.getCanvas().style.cursor = '');

    map.on('mousemove', 'communes-fill', (e) => {
        if (e.features.length > 0) {
            const p = e.features[0].properties;
            showTooltip(e.lngLat, `<strong>${p.nom_commune}</strong><br>${p.nom_epci}`);
        }
    });
    map.on('mouseleave', 'communes-fill', hideTooltip);

    // Select EPCI
    const selectEpci = document.getElementById('filtre-epci');
    epcisGeoCache.features.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.properties.code_epci;
        opt.textContent = f.properties.nom_epci;
        selectEpci.appendChild(opt);
    });

    selectEpci.addEventListener('change', async () => {
        const code = selectEpci.value;
        const sel = document.getElementById('filtre-commune');
        sel.innerHTML = '<option value="">Toutes les communes</option>';
        if (code) {
            const res = await fetch(`/api/communes_epci/${code}`);
            const communes = await res.json();
            communes.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.code_commune;
                opt.textContent = c.nom_commune;
                sel.appendChild(opt);
            });
        }
    });

    // Select NAF
    Object.entries(sectionsNaf).forEach(([code, libelle]) => {
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = `${code} — ${libelle}`;
        document.getElementById('filtre-naf').appendChild(opt);
    });

    document.getElementById('btn-appliquer').addEventListener('click', appliquerFiltres);
    appliquerFiltres();
});

async function appliquerFiltres() {
    const btn = document.getElementById('btn-appliquer');
    btn.textContent = 'Chargement...';
    btn.disabled = true;

    const epci    = document.getElementById('filtre-epci').value;
    const commune = document.getElementById('filtre-commune').value;
    const naf     = document.getElementById('filtre-naf').value;
    modeColor     = document.getElementById('filtre-couleur').value;

    const types = Array.from(
        document.querySelectorAll('#filtre-evenements input:checked')
    ).map(cb => cb.value);

    const periode = getParamsPeriode();

    const paramsEtab  = new URLSearchParams();
    const paramsStats = new URLSearchParams();

    // Géographie
    if (commune) {
        paramsEtab.set('code_commune', commune);
        paramsStats.set('code_commune', commune);
    } else if (epci) {
        paramsEtab.set('code_epci', epci);
        paramsStats.set('code_epci', epci);
    }

    // NAF
    if (naf) { paramsEtab.set('section_naf', naf); paramsStats.set('section_naf', naf); }

    // Période
    Object.entries(periode).forEach(([k, v]) => {
        paramsEtab.set(k, v);
        paramsStats.set(k, v);
    });

    // Types événements
    types.forEach(t => { paramsEtab.append('types', t); paramsStats.append('types', t); });

    const [etabRes, statsRes] = await Promise.all([
        fetch(`/api/etablissements?${paramsEtab}`),
        fetch(`/api/stats?${paramsStats}`)
    ]);

    const etabData  = await etabRes.json();
    const statsData = await statsRes.json();

    map.getSource('etablissements').setData(etabData);
    appliquerCouleurs();
    mettreAJourStats(etabData, statsData);
    mettreAJourGraphiques(statsData, periode, commune);
    recentrerCarte(epci, commune);

    btn.textContent = 'Appliquer';
    btn.disabled = false;
}

function appliquerCouleurs() {
    let colorExpr;
    if (modeColor === 'etat_admin') {
        colorExpr = ['match', ['get', 'etat_admin'], 'A', '#4CAF50', 'F', '#F44336', '#999'];
    } else if (modeColor === 'section_naf') {
        const cases = [];
        Object.entries(COULEURS_NAF).forEach(([k,v]) => cases.push(k, v));
        colorExpr = ['match', ['get', 'section_naf'], ...cases, '#999'];
    } else if (modeColor === 'tranche_effectif') {
        colorExpr = ['match', ['get', 'tranche_effectif'],
            'Etablissement non employeur', '#607D8B',
            '1 ou 2 salariés', '#4CAF50', '3 à 5 salariés', '#8BC34A',
            '6 à 9 salariés', '#FFC107', '10 à 19 salariés', '#FF9800',
            '20 à 49 salariés', '#FF5722', '50 à 99 salariés', '#F44336',
            '100 à 199 salariés', '#9C27B0', '#1A237E'
        ];
    } else if (modeColor === 'type_evenement') {
        colorExpr = ['match', ['get', 'etat_admin'], 'A', '#4CAF50', '#F44336'];
    } else {
        colorExpr = '#4a90d9';
    }
    map.setPaintProperty('etablissements-points', 'circle-color', colorExpr);
    mettreAJourLegende();
}

function mettreAJourStats(etabData, statsData) {
    const total      = etabData.total;
    const creations  = statsData.total_creations;
    const cessations = statsData.total_cessations;
    const solde      = statsData.solde_periode;

    document.getElementById('an-total').textContent      = total.toLocaleString('fr-FR');
    document.getElementById('an-creations').textContent  = creations.toLocaleString('fr-FR');
    document.getElementById('an-cessations').textContent = cessations.toLocaleString('fr-FR');

    const soldeEl = document.getElementById('an-solde');
    soldeEl.textContent = (solde >= 0 ? '+' : '') + solde.toLocaleString('fr-FR');
    soldeEl.className   = 'stat-valeur ' + (solde >= 0 ? 'vert' : 'rouge');

    const actifs = etabData.features.filter(f => f.properties.etat_admin === 'A').length;
    const fermes = etabData.features.filter(f => f.properties.etat_admin === 'F').length;
    document.getElementById('stat-total').textContent  = `${total.toLocaleString('fr-FR')} établissements`;
    document.getElementById('stat-actifs').textContent = `${actifs.toLocaleString('fr-FR')} actifs`;
    document.getElementById('stat-fermes').textContent = `${fermes.toLocaleString('fr-FR')} fermés`;
}

function mettreAJourGraphiques(statsData, periode, filtreCommune) {
    const mode = periode.mode;

    // Construire les labels selon le mode
    let labels = [];
    let creationsData = [];
    let cessationsData = [];

    if (mode === 'trimestre') {
        // Grouper par annee+trimestre
        const map_data = {};
        statsData.evolution.forEach(r => {
            const key = `T${r.trimestre} ${r.annee}`;
            if (!map_data[key]) map_data[key] = { creation: 0, cessation: 0 };
            map_data[key][r.type_evenement] = (map_data[key][r.type_evenement] || 0) + r.nb;
        });
        labels = Object.keys(map_data);
        creationsData  = labels.map(k => map_data[k].creation  || 0);
        cessationsData = labels.map(k => map_data[k].cessation || 0);
        document.getElementById('titre-evolution').textContent = 'Créations / Cessations par trimestre';
    } else {
        // Mode annuel
        const anneeDebut = parseInt(periode.annee_debut);
        const anneeFin   = parseInt(periode.annee_fin);
        for (let a = anneeDebut; a <= anneeFin; a++) labels.push(a);

        const cMap = {}, csMap = {};
        labels.forEach(a => { cMap[a] = 0; csMap[a] = 0; });
        statsData.evolution.forEach(r => {
            if (r.type_evenement === 'creation')  cMap[r.annee]  = r.nb;
            if (r.type_evenement === 'cessation') csMap[r.annee] = r.nb;
        });
        creationsData  = labels.map(a => cMap[a]);
        cessationsData = labels.map(a => csMap[a]);
        document.getElementById('titre-evolution').textContent = 'Créations / Cessations par année';
    }

    if (chartEvolution) chartEvolution.destroy();
    chartEvolution = new Chart(document.getElementById('chart-evolution').getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Créations',  data: creationsData,  backgroundColor: '#4CAF5099', borderColor: '#4CAF50', borderWidth: 1 },
                { label: 'Cessations', data: cessationsData, backgroundColor: '#F4433699', borderColor: '#F44336', borderWidth: 1 }
            ]
        },
        options: {
            responsive: true,
            plugins: { legend: { labels: { color: '#e8eaf0', font: { size: 10 } } } },
            scales: {
                x: { ticks: { color: '#8892a4', font: { size: 9 }, maxRotation: 45 }, grid: { color: '#2e3650' } },
                y: { ticks: { color: '#8892a4', font: { size: 9 } }, grid: { color: '#2e3650' } }
            }
        }
    });

    if (chartSecteurs) chartSecteurs.destroy();
    const top10 = statsData.secteurs.slice(0, 10);
    chartSecteurs = new Chart(document.getElementById('chart-secteurs').getContext('2d'), {
        type: 'bar',
        data: {
            labels: top10.map(r => LABELS_NAF[r.section_naf] || r.section_naf || '?'),
            datasets: [{ data: top10.map(r => r.nb), backgroundColor: top10.map(r => COULEURS_NAF[r.section_naf] || '#999'), borderWidth: 0 }]
        },
        options: {
            indexAxis: 'y', responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: '#8892a4', font: { size: 9 } }, grid: { color: '#2e3650' } },
                y: { ticks: { color: '#8892a4', font: { size: 9 } }, grid: { color: '#2e3650' } }
            }
        }
    });

    const blocCommunes = document.getElementById('bloc-communes');
    if (!filtreCommune && statsData.top_communes && statsData.top_communes.length > 0) {
        blocCommunes.style.display = 'block';
        if (chartCommunes) chartCommunes.destroy();
        chartCommunes = new Chart(document.getElementById('chart-communes').getContext('2d'), {
            type: 'bar',
            data: {
                labels: statsData.top_communes.map(r => r.nom_commune),
                datasets: [{ data: statsData.top_communes.map(r => r.nb_creations), backgroundColor: '#4a90d999', borderColor: '#4a90d9', borderWidth: 1 }]
            },
            options: {
                indexAxis: 'y', responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: '#8892a4', font: { size: 9 } }, grid: { color: '#2e3650' } },
                    y: { ticks: { color: '#8892a4', font: { size: 9 } }, grid: { color: '#2e3650' } }
                }
            }
        });
    } else {
        blocCommunes.style.display = 'none';
        if (chartCommunes) { chartCommunes.destroy(); chartCommunes = null; }
    }
}

function mettreAJourLegende() {
    const legende = document.getElementById('legende');
    const today = new Date();
    const dateStr = today.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    legende.innerHTML = '';

    if (modeColor === 'etat_admin' || modeColor === 'type_evenement') {
        legende.innerHTML += `<div class="leg-date">État au ${dateStr}</div>`;
        [['#4CAF50','Actif'],['#F44336','Fermé — créé sur la période']].forEach(([c,l]) => {
            legende.innerHTML += `<div class="leg-item"><span class="leg-dot" style="background:${c}"></span>${l}</div>`;
        });
    } else if (modeColor === 'section_naf') {
        legende.innerHTML += `<div class="leg-date">Secteur au ${dateStr}</div>`;
        Object.entries(COULEURS_NAF).forEach(([k,c]) => {
            legende.innerHTML += `<div class="leg-item"><span class="leg-dot" style="background:${c}"></span>${k} — ${LABELS_NAF[k]}</div>`;
        });
    } else if (modeColor === 'tranche_effectif') {
        legende.innerHTML += `<div class="leg-date">Effectif au ${dateStr}</div>`;
        [['#607D8B','Non employeur'],['#4CAF50','1-2'],['#8BC34A','3-5'],
         ['#FFC107','6-9'],['#FF9800','10-19'],['#FF5722','20-49'],
         ['#F44336','50-99'],['#9C27B0','100-199'],['#1A237E','200+']
        ].forEach(([c,l]) => {
            legende.innerHTML += `<div class="leg-item"><span class="leg-dot" style="background:${c}"></span>${l} sal.</div>`;
        });
    }
}

function getBoundsFromGeometry(geometry) {
    let coords = [];
    if (geometry.type === 'Polygon') {
        coords = geometry.coordinates[0];
    } else if (geometry.type === 'MultiPolygon') {
        geometry.coordinates.forEach(poly => poly[0].forEach(c => coords.push(c)));
    }
    if (!coords.length) return null;
    const lons = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);
    return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
}

function recentrerCarte(epci, commune) {
    if (commune && communesGeoCache) {
        const f = communesGeoCache.features.find(f => f.properties.code_commune === commune);
        if (f) { const b = getBoundsFromGeometry(f.geometry); if (b) map.fitBounds(b, { padding: 80, duration: 800 }); }
    } else if (epci && epcisGeoCache) {
        const f = epcisGeoCache.features.find(f => f.properties.code_epci === epci);
        if (f) { const b = getBoundsFromGeometry(f.geometry); if (b) map.fitBounds(b, { padding: 40, duration: 800 }); }
    }
}

const tooltip = document.createElement('div');
tooltip.id = 'map-tooltip';
document.body.appendChild(tooltip);

function showTooltip(lngLat, html) {
    const point = map.project(lngLat);
    tooltip.innerHTML = html;
    tooltip.style.display = 'block';
    tooltip.style.left = (point.x + 12) + 'px';
    tooltip.style.top  = (point.y - 10) + 'px';
}
function hideTooltip() { tooltip.style.display = 'none'; }

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

const SEUIL_POINTS = 8000;

let modeColor             = 'etat_admin';
let modePeriode           = 'annee';
let modeAffichage         = 'points';
let modeAffichagePrincipal = 'evenements';
let currentFiltres        = {};
let chartEvolution        = null;
let chartSecteurs         = null;
let chartCommunes         = null;
let chartSoldeSecteur     = null;
let chartAnciennete       = null;
let chartSecteursStock    = null;
let chartCommunesStock    = null;
let chartEffectifStock    = null;
let sectionsNaf           = {};
let communesGeoCache      = null;
let epcisGeoCache         = null;
let moveTimer             = null;

// --- Helpers période ---
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

function buildParams(extra = {}) {
    const p = new URLSearchParams();
    const f = { ...currentFiltres, ...extra };
    Object.entries(f).forEach(([k, v]) => {
        if (Array.isArray(v)) v.forEach(val => p.append(k, val));
        else p.set(k, v);
    });
    return p;
}

// --- MODE AFFICHAGE PRINCIPAL ---
function setModeAffichagePrincipal(mode) {
    modeAffichagePrincipal = mode;

    // Boutons
    document.getElementById('btn-mode-evenements').classList.toggle('active', mode === 'evenements');
    document.getElementById('btn-mode-stock').classList.toggle('active', mode === 'stock');
    document.getElementById('btn-mode-comparaison').classList.toggle('active', mode === 'comparaison');

    // Filtres
    document.getElementById('filtres-standard').style.display    = mode !== 'comparaison' ? 'block' : 'none';
    document.getElementById('filtres-comparaison').style.display = mode === 'comparaison' ? 'block' : 'none';
    document.getElementById('filtres-temporels').style.display   = (mode === 'evenements' || mode === 'comparaison') ? 'block' : 'none';
    document.getElementById('bloc-type-evenement').style.display = mode !== 'stock'       ? 'block' : 'none';

    // Sections analyses
    document.getElementById('analyses-evenements').style.display  = mode === 'evenements'  ? 'block' : 'none';
    document.getElementById('analyses-stock').style.display       = mode === 'stock'       ? 'block' : 'none';
    document.getElementById('analyses-comparaison').style.display = mode === 'comparaison' ? 'block' : 'none';

    if (mode === 'stock') {
        chargerStockActuel();
    } else if (mode === 'comparaison') {
        initComparaisonSelects();
        // Vider et masquer tous les éléments
        map.getSource('etablissements').setData({ type: 'FeatureCollection', features: [] });
        map.setLayoutProperty('etablissements-points', 'visibility', 'none');
        map.setPaintProperty('communes-choro', 'fill-opacity', 0);
        map.setPaintProperty('communes-fill', 'fill-color', '#1e2a3a');
        map.setPaintProperty('communes-fill', 'fill-opacity', 0.6);
        map.getSource('communes').setData(communesGeoCache);
    } else {
        // Réinitialiser à la sortie de la comparaison
        map.getSource('communes').setData(communesGeoCache);
        map.setPaintProperty('communes-fill', 'fill-color', '#1e2a3a');
        map.setPaintProperty('communes-fill', 'fill-opacity', 0.6);
        map.getSource('etablissements').setData({ type: 'FeatureCollection', features: [] });
    }
}

// --- MapLibre ---
const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8, sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#0f1118' } }]
    },
    center: [5.724, 45.188],
    zoom: 9,
    preserveDrawingBuffer: true
});

map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

map.on('load', async () => {
    const bornesRes = await fetch('api/bornes_periode');
    const bornes    = await bornesRes.json();
    document.getElementById('annee-debut').value      = Math.max(bornes.max_annee - 5, bornes.min_annee);
    document.getElementById('annee-fin').value        = bornes.max_annee;
    document.getElementById('annee-debut-trim').value = Math.max(bornes.max_annee - 2, bornes.min_annee);
    document.getElementById('annee-fin-trim').value   = bornes.max_annee;
    document.getElementById('trim-fin').value         = bornes.max_trim || 4;

    const [epcisRes, communesRes, sectionsRes] = await Promise.all([
        fetch('api/epcis'), fetch('api/communes'), fetch('api/sections_naf')
    ]);
    epcisGeoCache    = await epcisRes.json();
    communesGeoCache = await communesRes.json();
    sectionsNaf      = await sectionsRes.json();

    map.addSource('communes', { type: 'geojson', data: communesGeoCache });
    map.addLayer({ id: 'communes-choro', type: 'fill', source: 'communes', paint: { 'fill-color': '#1e2a3a', 'fill-opacity': 0 } });
    map.addLayer({ id: 'communes-fill',  type: 'fill', source: 'communes', paint: { 'fill-color': '#1e2a3a', 'fill-opacity': 0.6 } });
    map.addLayer({ id: 'communes-stroke', type: 'line', source: 'communes', paint: { 'line-color': '#2e4a6a', 'line-width': 0.5 } });

    map.addSource('epcis', { type: 'geojson', data: epcisGeoCache });
    map.addLayer({ id: 'epcis-stroke', type: 'line', source: 'epcis', paint: { 'line-color': '#4a90d9', 'line-width': 2 } });

    map.addSource('etablissements', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
        id: 'etablissements-points', type: 'circle', source: 'etablissements',
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2, 12, 4, 15, 7],
            'circle-color': '#4a90d9',
            'circle-opacity': 0.85,
            'circle-stroke-width': 0.3,
            'circle-stroke-color': '#ffffff'
        }
    });

    // Popup unique - multi-établissements
    const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '360px' });
    map.on('click', 'etablissements-points', (e) => {
        const bbox = [[e.point.x - 5, e.point.y - 5], [e.point.x + 5, e.point.y + 5]];
        const features = map.queryRenderedFeatures(bbox, { layers: ['etablissements-points'] });
        const seen = new Set();
        let unique = features.filter(f => {
            if (seen.has(f.properties.siret)) return false;
            seen.add(f.properties.siret);
            return true;
        });
        if (modeAffichagePrincipal === 'stock') {
            unique = unique.filter(f => f.properties.etat_admin === 'A');
        }
        if (unique.length === 0) return;
        if (unique.length === 1) {
            afficherPopupSimple(popup, e.lngLat, unique[0].properties);
        } else {
            afficherPopupMulti(popup, e.lngLat, unique.map(f => f.properties));
        }
    });

    map.on('mouseenter', 'etablissements-points', () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', 'etablissements-points', () => map.getCanvas().style.cursor = '');

    map.on('mousemove', 'communes-choro', (e) => {
        if (e.features.length > 0) {
            const p = e.features[0].properties;
            const solde = p.solde || 0;
            const signe = solde >= 0 ? '+' : '';
            showTooltip(e.lngLat, `<strong>${p.nom_commune}</strong><br>🟢 ${p.nb_creations || 0} créations — 🔴 ${p.nb_cessations || 0} cessations<br><strong>Solde : ${signe}${solde}</strong>`);
        }
    });
    map.on('mouseleave', 'communes-choro', hideTooltip);
    map.on('mousemove', 'communes-fill', (e) => {
        if (modeAffichage === 'points' && e.features.length > 0) {
            const p = e.features[0].properties;
            showTooltip(e.lngLat, `<strong>${p.nom_commune}</strong><br>${p.nom_epci}`);
        }
    });
    map.on('mouseleave', 'communes-fill', hideTooltip);

    // Selects EPCI
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
            const res = await fetch(`api/communes_epci/${code}`);
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

    await initFondCarte();
    appliquerFiltres();
});

// --- APPLIQUER FILTRES ---
async function appliquerFiltres() {
    if (modeAffichagePrincipal === 'stock') {
        await chargerStockActuel();
        return;
    }
    if (modeAffichagePrincipal === 'comparaison') {
        await appliquerComparaison();
        return;
    }
    const btn = document.getElementById('btn-appliquer');
    btn.textContent = 'Chargement...';
    btn.disabled = true;
    try {
        const epci    = document.getElementById('filtre-epci').value;
        const commune = document.getElementById('filtre-commune').value;
        const naf     = document.getElementById('filtre-naf').value;
        modeColor     = document.getElementById('filtre-couleur').value;
        const periode = getParamsPeriode();
        const types   = Array.from(document.querySelectorAll('#filtre-evenements input:checked')).map(cb => cb.value);

        currentFiltres = {};
        if (commune)      currentFiltres.code_commune = commune;
        else if (epci)    currentFiltres.code_epci = epci;
        if (naf)          currentFiltres.section_naf = naf;
        Object.entries(periode).forEach(([k,v]) => currentFiltres[k] = v);
        if (types.length) currentFiltres.types = types;

        const [statsRes, countRes] = await Promise.all([
            fetch(`api/stats?${buildParams()}`),
            fetch(`api/count_etablissements?${buildParams()}`)
        ]);
        const statsData = await statsRes.json();
        const countData = await countRes.json();
        const nb        = countData.count;

        mettreAJourIndicateur(nb);

        if (commune || nb <= SEUIL_POINTS) {
            modeAffichage = 'points';
            await chargerPointsDirects();
        } else {
            modeAffichage = 'choro';
            await afficherChoroplèthe(types);
            map.getSource('etablissements').setData({ type: 'FeatureCollection', features: [] });
        }

        mettreAJourStats(nb, statsData);
        mettreAJourGraphiques(statsData, periode, commune);
        mettreAJourSoldeSecteur(statsData);
        mettreAJourTauxSurvie();
        recentrerCarte(epci, commune);
    } catch(e) {
        console.error('Erreur appliquerFiltres:', e);
    } finally {
        btn.textContent = 'Appliquer';
        btn.disabled = false;
    }
}

// --- RESET ---
async function resetFiltres() {
    document.getElementById('filtre-epci').value    = '';
    document.getElementById('filtre-commune').innerHTML = '<option value="">Toutes les communes</option>';
    document.getElementById('filtre-naf').value     = '';
    document.getElementById('filtre-couleur').value = 'etat_admin';
    setMode('annee');
    const bornesRes = await fetch('api/bornes_periode');
    const bornes    = await bornesRes.json();
    document.getElementById('annee-debut').value = Math.max(bornes.max_annee - 5, bornes.min_annee);
    document.getElementById('annee-fin').value   = bornes.max_annee;
    document.querySelectorAll('#filtre-evenements input').forEach(cb => {
        cb.checked = (cb.value === 'creation' || cb.value === 'cessation');
    });
    appliquerFiltres();
}

// --- CHARGEMENT POINTS ---
async function chargerPointsDirects() {
    modeAffichage = 'points';
    map.setPaintProperty('communes-choro', 'fill-opacity', 0);
    map.setPaintProperty('communes-fill', 'fill-opacity', 0.6);
    map.setLayoutProperty('etablissements-points', 'visibility', 'visible');
    const res  = await fetch(`api/etablissements?${buildParams()}&limit=2000`);
    const data = await res.json();
    map.getSource('etablissements').setData(data);
    appliquerCouleurs();
}

async function chargerPointsBbox() {
    const bounds = map.getBounds();
    const params = buildParams({
        min_lon: bounds.getWest(), min_lat: bounds.getSouth(),
        max_lon: bounds.getEast(), max_lat: bounds.getNorth()
    });
    const res  = await fetch(`api/etablissements_bbox?${params}`);
    const data = await res.json();
    map.getSource('etablissements').setData(data);
    appliquerCouleurs();
    document.getElementById('stat-total').textContent = `${data.total.toLocaleString('fr-FR')} établissements (vue)`;
}

// --- CHOROPLÈTHE ---
async function afficherChoroplèthe(types) {
    map.setLayoutProperty('etablissements-points', 'visibility', 'none');
    map.setPaintProperty('communes-fill', 'fill-opacity', 0);

    const res             = await fetch(`api/stats_communes?${buildParams()}`);
    const statsParCommune = await res.json();

    const updatedFeatures = communesGeoCache.features.map(f => ({
        ...f,
        properties: {
            ...f.properties,
            nb_creations:  statsParCommune[f.properties.code_commune]?.nb_creations  || 0,
            nb_cessations: statsParCommune[f.properties.code_commune]?.nb_cessations || 0,
            solde:         statsParCommune[f.properties.code_commune]?.solde         || 0
        }
    }));
    map.getSource('communes').setData({ ...communesGeoCache, features: updatedFeatures });

    const onlyCreations  = types.includes('creation')  && !types.includes('cessation');
    const onlyCessations = types.includes('cessation') && !types.includes('creation');
    const valeurs = Object.values(statsParCommune);
    const maxVal  = Math.max(...valeurs.map(r => Math.max(r.nb_creations, r.nb_cessations, Math.abs(r.solde))), 1);

    let colorExpr;
    if (onlyCreations) {
        colorExpr = ['interpolate', ['linear'], ['get', 'nb_creations'], 0, '#1e2a3a', maxVal*0.1, '#a5d6a7', maxVal*0.4, '#43a047', maxVal, '#1b5e20'];
    } else if (onlyCessations) {
        colorExpr = ['interpolate', ['linear'], ['get', 'nb_cessations'], 0, '#1e2a3a', maxVal*0.1, '#90caf9', maxVal*0.4, '#1e88e5', maxVal, '#0d47a1'];
    } else {
        const maxSolde = Math.max(...valeurs.map(r => Math.abs(r.solde)), 1);
        colorExpr = ['interpolate', ['linear'], ['get', 'solde'], -maxSolde, '#7f0000', -maxSolde*0.3, '#e53935', 0, '#37474f', maxSolde*0.3, '#43a047', maxSolde, '#1b5e20'];
    }
    map.setPaintProperty('communes-choro', 'fill-color', colorExpr);
    map.setPaintProperty('communes-choro', 'fill-opacity', 0.8);
    mettreAJourIndicateur(null, true);
}

// --- STOCK ACTUEL ---
async function chargerStockActuel() {
    // Réinitialiser les couleurs communes si on vient de la comparaison
    map.getSource('communes').setData(communesGeoCache);
    map.setPaintProperty('communes-fill', 'fill-color', '#1e2a3a');

    const epci    = document.getElementById('filtre-epci').value;
    const commune = document.getElementById('filtre-commune').value;
    const naf     = document.getElementById('filtre-naf').value;
    modeColor = document.getElementById('filtre-couleur').value;

    const params = new URLSearchParams();
    if (commune)   params.set('code_commune', commune);
    else if (epci) params.set('code_epci', epci);
    if (naf)       params.set('section_naf', naf);

    const res  = await fetch(`api/stock_actuel?${params}`);
    const data = await res.json();

    modeAffichage = 'points';
    map.setPaintProperty('communes-choro', 'fill-opacity', 0);
    map.setPaintProperty('communes-fill', 'fill-opacity', 0.6);
    map.setLayoutProperty('etablissements-points', 'visibility', 'visible');

    const geojsonActifs = {
        type: 'FeatureCollection',
        features: data.features.filter(f => f.properties.etat_admin === 'A')
    };
    map.getSource('etablissements').setData(geojsonActifs);
    appliquerCouleurs();

    document.getElementById('stat-total').textContent  = `${data.total.toLocaleString('fr-FR')} établissements actifs`;
    document.getElementById('stat-actifs').textContent = `${data.nb_affiches.toLocaleString('fr-FR')} affichés`;
    document.getElementById('stat-fermes').textContent = 'Stock au ' + new Date().toLocaleDateString('fr-FR');
    document.getElementById('an-total').textContent      = data.total.toLocaleString('fr-FR');
    document.getElementById('an-creations').textContent  = '—';
    document.getElementById('an-cessations').textContent = '—';
    document.getElementById('an-solde').textContent      = 'actifs';
    document.getElementById('an-solde').className        = 'stat-valeur vert';

    // Graphiques Situation Actuelle
    mettreAJourGraphiquesStock(data);

    recentrerCarte(epci, commune);
}

function mettreAJourGraphiquesStock(data) {
    document.getElementById('stock-total').textContent = (data.total || 0).toLocaleString('fr-FR');

    const optsH = { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } },
        scales: { x: { ticks: { color: '#8892a4', font: { size: 9 } }, grid: { color: '#2e3650' } },
                  y: { ticks: { color: '#8892a4', font: { size: 9 } }, grid: { color: '#2e3650' } } } };
    const optsV = { responsive: true, plugins: { legend: { display: false } },
        scales: { x: { ticks: { color: '#8892a4', font: { size: 9 } }, grid: { color: '#2e3650' } },
                  y: { ticks: { color: '#8892a4', font: { size: 9 } }, grid: { color: '#2e3650' } } } };

    // 1. Secteurs
    if (chartSecteursStock) chartSecteursStock.destroy();
    const top10 = (data.secteurs || []).slice(0, 10);
    chartSecteursStock = new Chart(document.getElementById('chart-secteurs-stock').getContext('2d'), {
        type: 'bar',
        data: { labels: top10.map(r => LABELS_NAF[r.section_naf] || r.section_naf || '?'),
            datasets: [{ data: top10.map(r => r.nb), backgroundColor: top10.map(r => COULEURS_NAF[r.section_naf] || '#999'), borderWidth: 0 }] },
        options: optsH
    });

    // 2. Top communes
    if (chartCommunesStock) chartCommunesStock.destroy();
    if (data.top_communes && data.top_communes.length > 0) {
        chartCommunesStock = new Chart(document.getElementById('chart-communes-stock').getContext('2d'), {
            type: 'bar',
            data: { labels: data.top_communes.map(r => r.nom_commune),
                datasets: [{ data: data.top_communes.map(r => r.nb), backgroundColor: '#4a90d999', borderColor: '#4a90d9', borderWidth: 1 }] },
            options: optsH
        });
    }

    // 3. Ancienneté
    if (chartAnciennete) chartAnciennete.destroy();
    if (data.anciennete) {
        const a = data.anciennete;
        chartAnciennete = new Chart(document.getElementById('chart-anciennete').getContext('2d'), {
            type: 'bar',
            data: { labels: ['Avant 2000', '2000–2009', '2010–2019', 'Depuis 2020'],
                datasets: [{ data: [a.avant_2000, a.annees_2000, a.annees_2010, a.depuis_2020],
                    backgroundColor: ['#607D8B99','#FF980099','#4a90d999','#4CAF5099'],
                    borderColor: ['#607D8B','#FF9800','#4a90d9','#4CAF50'], borderWidth: 1 }] },
            options: optsV
        });
        if (a.annee_mediane) {
            const age = new Date().getFullYear() - a.annee_mediane;
            document.getElementById('stock-anciennete-mediane').textContent = age;
        }
    }

    // 4. Effectif
    if (chartEffectifStock) chartEffectifStock.destroy();
    if (data.effectifs && data.effectifs.length > 0) {
        chartEffectifStock = new Chart(document.getElementById('chart-effectif-stock').getContext('2d'), {
            type: 'bar',
            data: { labels: data.effectifs.map(r => r.tranche || 'N/R'),
                datasets: [{ data: data.effectifs.map(r => r.nb), backgroundColor: '#9C27B099', borderColor: '#9C27B0', borderWidth: 1 }] },
            options: optsH
        });
    }
}

// --- MOVEEND ---
map.on('moveend', async () => {
    if (Object.keys(currentFiltres).length === 0) return;

    if (modeAffichagePrincipal === 'stock') {
        if (moveTimer) clearTimeout(moveTimer);
        moveTimer = setTimeout(async () => {
            const bounds = map.getBounds();
            const epci    = document.getElementById('filtre-epci').value;
            const commune = document.getElementById('filtre-commune').value;
            const naf     = document.getElementById('filtre-naf').value;
            const params  = new URLSearchParams({
                min_lon: bounds.getWest(), min_lat: bounds.getSouth(),
                max_lon: bounds.getEast(), max_lat: bounds.getNorth()
            });
            if (commune)   params.set('code_commune', commune);
            else if (epci) params.set('code_epci', epci);
            if (naf)       params.set('section_naf', naf);
            const res  = await fetch(`api/stock_actuel?${params}`);
            const data = await res.json();
            const geojsonActifs = {
                type: 'FeatureCollection',
                features: data.features.filter(f => f.properties.etat_admin === 'A')
            };
            map.getSource('etablissements').setData(geojsonActifs);
            modeColor = document.getElementById('filtre-couleur').value;
            appliquerCouleurs();
        }, 400);
        return;
    }

    if (modeAffichage === 'points') return;
    if (moveTimer) clearTimeout(moveTimer);

    moveTimer = setTimeout(async () => {
        const bounds = map.getBounds();
        const bboxOnly = new URLSearchParams({
            min_lon: bounds.getWest(), min_lat: bounds.getSouth(),
            max_lon: bounds.getEast(), max_lat: bounds.getNorth(),
            mode: currentFiltres.mode || 'annee',
            annee_debut: currentFiltres.annee_debut || '2020',
            annee_fin: currentFiltres.annee_fin || '2025'
        });
        if (currentFiltres.types) {
            const t = Array.isArray(currentFiltres.types) ? currentFiltres.types : [currentFiltres.types];
            t.forEach(v => bboxOnly.append('types', v));
        }
        const res  = await fetch(`api/count_etablissements?${bboxOnly}`);
        const data = await res.json();

        if (modeAffichage === 'choro' && data.count <= SEUIL_POINTS) {
            modeAffichage = 'bbox';
            map.setPaintProperty('communes-choro', 'fill-opacity', 0);
            map.setPaintProperty('communes-fill', 'fill-opacity', 0.6);
            map.setLayoutProperty('etablissements-points', 'visibility', 'visible');
            await chargerPointsBbox();
            mettreAJourIndicateur(data.count);
        } else if (modeAffichage === 'bbox' && data.count > SEUIL_POINTS) {
            modeAffichage = 'choro';
            map.setLayoutProperty('etablissements-points', 'visibility', 'none');
            const types = currentFiltres.types || ['creation', 'cessation'];
            await afficherChoroplèthe(Array.isArray(types) ? types : [types]);
        } else if (modeAffichage === 'bbox') {
            await chargerPointsBbox();
        }
    }, 400);
});

// --- COULEURS ---
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
            'Non employeur', '#607D8B',
            '1 ou 2 salariés', '#4CAF50', '3 à 5 salariés', '#8BC34A',
            '6 à 9 salariés', '#FFC107', '10 à 19 salariés', '#FF9800',
            '20 à 49 salariés', '#FF5722', '50 à 99 salariés', '#F44336',
            '100 à 199 salariés', '#9C27B0', '#1A237E'
        ];
    } else {
        colorExpr = '#4a90d9';
    }
    map.setPaintProperty('etablissements-points', 'circle-color', colorExpr);
    mettreAJourLegende();
}

// --- STATS ---
function mettreAJourStats(nb, statsData) {
    const creations  = statsData.total_creations;
    const cessations = statsData.total_cessations;
    const solde      = statsData.solde_periode;
    const actifs     = statsData.nb_actifs || 0;
    const fermes     = statsData.nb_fermes || 0;

    document.getElementById('an-total').textContent      = (nb || 0).toLocaleString('fr-FR');
    document.getElementById('an-creations').textContent  = creations.toLocaleString('fr-FR');
    document.getElementById('an-cessations').textContent = cessations.toLocaleString('fr-FR');
    const soldeEl = document.getElementById('an-solde');
    soldeEl.textContent = (solde >= 0 ? '+' : '') + solde.toLocaleString('fr-FR');
    soldeEl.className   = 'stat-valeur ' + (solde >= 0 ? 'vert' : 'rouge');
    document.getElementById('stat-total').textContent  = `${(nb || 0).toLocaleString('fr-FR')} établissements`;
    document.getElementById('stat-actifs').textContent = `${actifs.toLocaleString('fr-FR')} actifs`;
    document.getElementById('stat-fermes').textContent = `${fermes.toLocaleString('fr-FR')} fermés`;
}

function mettreAJourIndicateur(nb, isChoro = false) {
    const el = document.getElementById('zoom-info');
    if (!el) return;
    if (isChoro) {
        el.textContent = '🗺️ Choroplèthe — zoomez sur une zone pour voir les points';
        el.style.color = '#FF9800';
    } else {
        el.textContent = `📍 ${nb?.toLocaleString('fr-FR') || '—'} établissements — affichage points`;
        el.style.color = '#8892a4';
    }
}

// --- GRAPHIQUES ---
function mettreAJourGraphiques(statsData, periode, filtreCommune) {
    const mode = periode.mode;
    let labels = [], creationsData = [], cessationsData = [];

    if (mode === 'trimestre') {
        const map_data = {};
        statsData.evolution.forEach(r => {
            const key = `T${r.trimestre} ${r.annee}`;
            if (!map_data[key]) map_data[key] = { creation: 0, cessation: 0 };
            map_data[key][r.type_evenement] = (map_data[key][r.type_evenement] || 0) + r.nb;
        });
        labels         = Object.keys(map_data);
        creationsData  = labels.map(k => map_data[k].creation  || 0);
        cessationsData = labels.map(k => map_data[k].cessation || 0);
        document.getElementById('titre-evolution').textContent = 'Créations / Cessations par trimestre';
    } else {
        const ad = parseInt(periode.annee_debut), af = parseInt(periode.annee_fin);
        for (let a = ad; a <= af; a++) labels.push(a);
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

    // Construire les datasets pour tous les types d'événements cochés
    const TYPE_CONFIG = {
        'creation':     { label: 'Créations',     bg: '#4CAF5099', border: '#4CAF50' },
        'cessation':    { label: 'Cessations',    bg: '#F4433699', border: '#F44336' },
        'transfert':    { label: 'Transferts',    bg: '#FF980099', border: '#FF9800' },
        'redressement': { label: 'Redressements', bg: '#9C27B099', border: '#9C27B0' },
        'liquidation':  { label: 'Liquidations',  bg: '#60208099', border: '#602080' }
    };

    const types_coches = Array.isArray(currentFiltres.types) ? currentFiltres.types : [currentFiltres.types].filter(Boolean);

    // Reconstruire les données par type depuis statsData.evolution
    const datasets = [];
    types_coches.forEach(type => {
        if (!TYPE_CONFIG[type]) return;
        let data;
        if (mode === 'trimestre') {
            data = labels.map(k => {
                const row = statsData.evolution.find(r => `T${r.trimestre} ${r.annee}` === k && r.type_evenement === type);
                return row ? row.nb : 0;
            });
        } else {
            const ad = parseInt(periode.annee_debut), af = parseInt(periode.annee_fin);
            const dMap = {};
            for (let a = ad; a <= af; a++) dMap[a] = 0;
            statsData.evolution.filter(r => r.type_evenement === type).forEach(r => { dMap[r.annee] = r.nb; });
            data = labels.map(a => dMap[a] || 0);
        }
        datasets.push({
            label: TYPE_CONFIG[type].label,
            data,
            backgroundColor: TYPE_CONFIG[type].bg,
            borderColor: TYPE_CONFIG[type].border,
            borderWidth: 1
        });
    });

    // Titre adaptatif
    const titreEvt = types_coches.map(t => TYPE_CONFIG[t]?.label || t).join(' / ');
    document.getElementById('titre-evolution').textContent = `${titreEvt} par ${mode === 'trimestre' ? 'trimestre' : 'année'}`;

    if (chartEvolution) chartEvolution.destroy();
    chartEvolution = new Chart(document.getElementById('chart-evolution').getContext('2d'), {
        type: 'bar',
        data: { labels, datasets },
        options: { responsive: true, plugins: { legend: { labels: { color: '#e8eaf0', font: { size: 10 } } } },
            scales: { x: { ticks: { color: '#8892a4', font: { size: 9 }, maxRotation: 45 }, grid: { color: '#2e3650' } },
                      y: { ticks: { color: '#8892a4', font: { size: 9 } }, grid: { color: '#2e3650' } } } }
    });

    if (chartSecteurs) chartSecteurs.destroy();
    const top10 = statsData.secteurs.slice(0, 10);
    chartSecteurs = new Chart(document.getElementById('chart-secteurs').getContext('2d'), {
        type: 'bar',
        data: { labels: top10.map(r => LABELS_NAF[r.section_naf] || r.section_naf || '?'),
            datasets: [{ data: top10.map(r => r.nb), backgroundColor: top10.map(r => COULEURS_NAF[r.section_naf] || '#999'), borderWidth: 0 }] },
        options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } },
            scales: { x: { ticks: { color: '#8892a4', font: { size: 9 } }, grid: { color: '#2e3650' } },
                      y: { ticks: { color: '#8892a4', font: { size: 9 } }, grid: { color: '#2e3650' } } } }
    });

    const blocCommunes = document.getElementById('bloc-communes');
    if (!filtreCommune && statsData.top_communes && statsData.top_communes.length > 0) {
        blocCommunes.style.display = 'block';
        if (chartCommunes) chartCommunes.destroy();
        chartCommunes = new Chart(document.getElementById('chart-communes').getContext('2d'), {
            type: 'bar',
            data: { labels: statsData.top_communes.map(r => r.nom_commune),
                datasets: [{ data: statsData.top_communes.map(r => r.nb_creations), backgroundColor: '#4a90d999', borderColor: '#4a90d9', borderWidth: 1 }] },
            options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } },
                scales: { x: { ticks: { color: '#8892a4', font: { size: 9 } }, grid: { color: '#2e3650' } },
                          y: { ticks: { color: '#8892a4', font: { size: 9 } }, grid: { color: '#2e3650' } } } }
        });
    } else {
        blocCommunes.style.display = 'none';
        if (chartCommunes) { chartCommunes.destroy(); chartCommunes = null; }
    }
}

async function mettreAJourSoldeSecteur(statsData) {
    if (chartSoldeSecteur) chartSoldeSecteur.destroy();
    const secteurs = statsData.secteurs.slice(0, 8);
    if (!secteurs.length) return;
    chartSoldeSecteur = new Chart(document.getElementById('chart-solde-secteur').getContext('2d'), {
        type: 'bar',
        data: { labels: secteurs.map(r => LABELS_NAF[r.section_naf] || r.section_naf || '?'),
            datasets: [{ label: 'Actifs', data: secteurs.map(r => r.nb), backgroundColor: secteurs.map(r => COULEURS_NAF[r.section_naf] || '#999'), borderWidth: 0 }] },
        options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } },
            scales: { x: { ticks: { color: '#8892a4', font: { size: 9 } }, grid: { color: '#2e3650' } },
                      y: { ticks: { color: '#8892a4', font: { size: 9 } }, grid: { color: '#2e3650' } } } }
    });
}

async function mettreAJourTauxSurvie() {
    const params = buildParams();
    try {
        const res  = await fetch(`api/taux_survie?${params}`);
        const data = await res.json();
        document.getElementById('survie-taux').textContent   = `${data.taux_survie}%`;
        document.getElementById('survie-actifs').textContent = data.encore_actifs.toLocaleString('fr-FR');
        document.getElementById('survie-fermes').textContent = data.nb_fermes.toLocaleString('fr-FR');
        document.getElementById('survie-barre').style.width  = `${data.taux_survie}%`;
        document.getElementById('survie-note').textContent   = `Sur ${data.total_crees.toLocaleString('fr-FR')} établissements créés sur la période`;
    } catch(e) { console.error('Erreur taux survie:', e); }
}

// --- LÉGENDE ---
function mettreAJourLegende() {
    const legende = document.getElementById('legende');
    const dateStr = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    legende.innerHTML = '';

    if (modeAffichage === 'choro') {
        const types  = Array.isArray(currentFiltres.types) ? currentFiltres.types : [currentFiltres.types].filter(Boolean);
        const onlyC  = types.includes('creation')  && !types.includes('cessation');
        const onlyCs = types.includes('cessation') && !types.includes('creation');
        if (onlyC) {
            legende.innerHTML += `<div class="leg-date">Créations — intensité par commune</div>`;
            [['#1e2a3a','Aucune'],['#a5d6a7','Peu'],['#43a047','Moyen'],['#1b5e20','Beaucoup']].forEach(([c,l]) => {
                legende.innerHTML += `<div class="leg-item"><span class="leg-dot" style="background:${c};border:1px solid #444"></span>${l}</div>`;
            });
        } else if (onlyCs) {
            legende.innerHTML += `<div class="leg-date">Cessations — intensité par commune</div>`;
            [['#1e2a3a','Aucune'],['#90caf9','Peu'],['#1e88e5','Moyen'],['#0d47a1','Beaucoup']].forEach(([c,l]) => {
                legende.innerHTML += `<div class="leg-item"><span class="leg-dot" style="background:${c};border:1px solid #444"></span>${l}</div>`;
            });
        } else {
            legende.innerHTML += `<div class="leg-date">Solde net (créations - cessations)</div>`;
            [['#7f0000','Très négatif'],['#e53935','Négatif'],['#37474f','Neutre'],['#43a047','Positif'],['#1b5e20','Très positif']].forEach(([c,l]) => {
                legende.innerHTML += `<div class="leg-item"><span class="leg-dot" style="background:${c};border:1px solid #444"></span>${l}</div>`;
            });
        }
        return;
    }

    if (modeColor === 'etat_admin') {
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

// --- UTILITAIRES ---
function getBoundsFromGeometry(geometry) {
    let coords = [];
    if (geometry.type === 'Polygon') coords = geometry.coordinates[0];
    else if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach(p => p[0].forEach(c => coords.push(c)));
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

// --- FOND DE CARTE ---
let fondActuel = 'aucun';
let masqueZoneCharge = false;

async function initFondCarte() {
    map.addSource('ign-plan', { type: 'raster', tileSize: 256, attribution: '© IGN',
        tiles: ['https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}']
    });
    map.addSource('ign-ortho', { type: 'raster', tileSize: 256, attribution: '© IGN',
        tiles: ['https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}']
    });
    map.addLayer({ id: 'fond-plan',  type: 'raster', source: 'ign-plan',  layout: { visibility: 'none' }, paint: { 'raster-opacity': 1 } }, 'communes-choro');
    map.addLayer({ id: 'fond-ortho', type: 'raster', source: 'ign-ortho', layout: { visibility: 'none' }, paint: { 'raster-opacity': 1 } }, 'communes-choro');
    await chargerMasqueZone();
}

async function chargerMasqueZone() {
    if (masqueZoneCharge) return;
    const res  = await fetch('api/epcis');
    const data = await res.json();
    const monde = [[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]];
    const trous = [];
    data.features.forEach(f => {
        const geom = f.geometry;
        if (geom.type === 'Polygon') trous.push(geom.coordinates[0]);
        else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(poly => trous.push(poly[0]));
    });
    map.addSource('masque-zone', { type: 'geojson', data: { type: 'FeatureCollection', features: [{
        type: 'Feature', geometry: { type: 'Polygon', coordinates: [monde, ...trous] }, properties: {}
    }]}});
    map.addLayer({ id: 'masque-zone-fill', type: 'fill', source: 'masque-zone',
        paint: { 'fill-color': '#0f1118', 'fill-opacity': 1 } }, 'communes-choro');
    masqueZoneCharge = true;
}

function setFond(type) {
    fondActuel = type;
    document.querySelectorAll('.fond-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-fond-${type}`).classList.add('active');
    map.setLayoutProperty('fond-plan',  'visibility', type === 'plan'  ? 'visible' : 'none');
    map.setLayoutProperty('fond-ortho', 'visibility', type === 'ortho' ? 'visible' : 'none');
    if (type === 'aucun') {
        map.setPaintProperty('communes-fill', 'fill-color', '#1e2a3a');
        map.setPaintProperty('communes-fill', 'fill-opacity', 0.6);
    } else if (type === 'ortho') {
        map.setPaintProperty('communes-fill', 'fill-opacity', 0);
    } else {
        map.setPaintProperty('communes-fill', 'fill-color', '#1e2a3a');
        map.setPaintProperty('communes-fill', 'fill-opacity', 0.1);
    }
}

// --- POPUP ---
function afficherPopupSimple(popup, lngLat, p) {
    const etatLabel     = p.etat_admin === 'A' ? '🟢 Actif' : '🔴 Fermé';
    const dateCreation  = p.date_creation  ? p.date_creation.substring(0,10)  : null;
    const dateFermeture = p.date_fermeture ? p.date_fermeture.substring(0,10) : null;
    let contexte = '';
    if (dateCreation && dateFermeture)      contexte = `<div class="popup-contexte">⚠️ Créé le ${dateCreation}, fermé le ${dateFermeture}</div>`;
    else if (dateCreation && p.etat_admin === 'F') contexte = `<div class="popup-contexte">🔴 Créé le ${dateCreation} — fermé depuis</div>`;
    else if (dateCreation)                  contexte = `<div class="popup-contexte">🟢 Créé le ${dateCreation} — toujours actif</div>`;

    let noteBodacc = '';
    if      (p.dernier_evenement === 'liquidation'  && p.etat_admin === 'A') noteBodacc = `<div class="popup-note">⚠️ Annonce de liquidation publiée au Bodacc — état Sirene pas encore mis à jour</div>`;
    else if (p.dernier_evenement === 'redressement' && p.etat_admin === 'A') noteBodacc = `<div class="popup-note">ℹ️ Procédure de redressement publiée au Bodacc</div>`;
    else if (p.dernier_evenement === 'liquidation'  && p.etat_admin === 'F') noteBodacc = `<div class="popup-note">🔴 Liquidation judiciaire — établissement fermé</div>`;

    popup.setLngLat(lngLat).setHTML(`
        <div class="popup-content">
            <div class="popup-titre">${p.nom}</div>
            <div class="popup-etat">${etatLabel}</div>
            ${contexte}${noteBodacc}
            <div class="popup-ligne">${p.adresse || ''}</div>
            <div class="popup-ligne"><strong>Activité :</strong> ${p.libelle_naf || (p.section_naf ? LABELS_NAF[p.section_naf] : null) || p.code_naf || 'N/R'}</div>
            <div class="popup-ligne"><strong>Effectif :</strong> ${p.tranche_effectif || 'N/R'}</div>
            <div class="popup-ligne"><strong>Commune :</strong> ${p.nom_commune}</div>
            <div class="popup-ligne"><strong>SIRET :</strong> ${p.siret}</div>
        </div>
    `).addTo(map);
}

function afficherPopupMulti(popup, lngLat, etablissements) {
    const nb = etablissements.length;
    let items = '';
    etablissements.forEach((p, i) => {
        const etatIcon = p.etat_admin === 'A' ? '🟢' : '🔴';
        const activite = p.libelle_naf || (p.section_naf ? LABELS_NAF[p.section_naf] : null) || p.code_naf || 'N/R';
        const creation = p.date_creation ? p.date_creation.substring(0, 10) : 'N/R';
        items += `
            <div class="popup-multi-item" onclick="togglePopupDetail(${i})">
                <div class="popup-multi-header">
                    <span class="popup-multi-etat">${etatIcon}</span>
                    <span class="popup-multi-nom">${p.nom || 'N/A'}</span>
                </div>
                <div class="popup-multi-activite">${activite}</div>
                <div class="popup-multi-detail" id="popup-detail-${i}" style="display:none">
                    <div class="popup-ligne">${p.adresse || ''}</div>
                    <div class="popup-ligne"><strong>Activité :</strong> ${activite}</div>
                    <div class="popup-ligne"><strong>Effectif :</strong> ${p.tranche_effectif || 'N/R'}</div>
                    <div class="popup-ligne"><strong>Création :</strong> ${creation}</div>
                    <div class="popup-ligne"><strong>SIRET :</strong> ${p.siret}</div>
                </div>
            </div>
            ${i < nb - 1 ? '<hr class="popup-separator">' : ''}`;
    });
    popup.setLngLat(lngLat).setHTML(`
        <div class="popup-content popup-multi">
            <div class="popup-titre">${nb} établissements à cette adresse</div>
            <div class="popup-multi-note">Cliquez sur un nom pour voir le détail</div>
            ${items}
        </div>
    `).addTo(map);
}

function togglePopupDetail(index) {
    const el = document.getElementById(`popup-detail-${index}`);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

// --- TOGGLE PANNEAUX ---
let filtresCollapsed  = false;
let analysesCollapsed = false;

function togglePanel(side) {
    if (side === 'filtres') {
        filtresCollapsed = !filtresCollapsed;
        const btn = document.getElementById('btn-toggle-filtres');
        btn.classList.toggle('collapsed', filtresCollapsed);
        btn.textContent = filtresCollapsed ? '›' : '‹';
    } else {
        analysesCollapsed = !analysesCollapsed;
        const btn = document.getElementById('btn-toggle-analyses');
        btn.classList.toggle('collapsed', analysesCollapsed);
        btn.textContent = analysesCollapsed ? '‹' : '›';
    }

    const leftCol  = filtresCollapsed  ? '0px' : 'var(--panel-width)';
    const rightCol = analysesCollapsed ? '0px' : 'var(--panel-width)';
    document.getElementById('app').style.gridTemplateColumns = `${leftCol} 1fr ${rightCol}`;

    // Repositionner les boutons
    document.getElementById('btn-toggle-filtres').style.left  = filtresCollapsed  ? '0' : 'var(--panel-width)';
    document.getElementById('btn-toggle-analyses').style.right = analysesCollapsed ? '0' : 'var(--panel-width)';

    setTimeout(() => map.resize(), 350);
}



// --- EXPORT PDF ---
async function exporterPDF() {
    const btn = document.getElementById('btn-export-pdf');
    btn.textContent = '⏳ Génération PDF + CSV...';
    btn.disabled = true;

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

        const W = 297; // largeur A4 landscape
        const H = 210; // hauteur A4 landscape
        const marge = 10;

        // --- Couleurs ---
        const bleu  = [74, 144, 217];
        const gris  = [46, 54, 80];
        const blanc = [255, 255, 255];
        const texte = [232, 234, 240];

        // Fond sombre
        doc.setFillColor(15, 17, 24);
        doc.rect(0, 0, W, H, 'F');

        // --- EN-TÊTE ---
        doc.setFillColor(...gris);
        doc.rect(0, 0, W, 18, 'F');

        doc.setFontSize(16);
        doc.setTextColor(...bleu);
        doc.setFont('helvetica', 'bold');
        doc.text('DynEco', marge, 11);

        doc.setFontSize(9);
        doc.setTextColor(...texte);
        doc.setFont('helvetica', 'normal');
        doc.text('Observer le dynamisme économique de votre territoire', marge + 22, 11);

        // Date et mode
        const dateStr = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
        const modeStr = modeAffichagePrincipal === 'stock' ? 'Situation Actuelle' : 'Analyses Temporelles';
        doc.setFontSize(8);
        doc.setTextColor(...texte);
        doc.text(`${modeStr} — ${dateStr}`, W - marge, 11, { align: 'right' });

        // --- FILTRES ---
        const epciEl    = document.getElementById('filtre-epci');
        const communeEl = document.getElementById('filtre-commune');
        const nafEl     = document.getElementById('filtre-naf');
        const epciTxt    = epciEl.options[epciEl.selectedIndex]?.text || 'Tous les EPCI';
        const communeTxt = communeEl.options[communeEl.selectedIndex]?.text || 'Toutes les communes';
        const nafTxt     = nafEl.options[nafEl.selectedIndex]?.text || 'Tous secteurs';

        let filtresTxt = `Zone : ${epciTxt}`;
        if (communeTxt !== 'Toutes les communes') filtresTxt += ` › ${communeTxt}`;
        if (nafTxt !== 'Tous secteurs') filtresTxt += ` | Secteur : ${nafTxt}`;

        if (modeAffichagePrincipal === 'evenements') {
            const debut = document.getElementById('annee-debut')?.value || '';
            const fin   = document.getElementById('annee-fin')?.value || '';
            const types = Array.from(document.querySelectorAll('#filtre-evenements input:checked')).map(cb => cb.value).join(', ');
            filtresTxt += ` | Période : ${debut}–${fin} | Types : ${types}`;
        }

        doc.setFontSize(7);
        doc.setTextColor(136, 146, 164);
        doc.text(filtresTxt, marge, 16);

        // --- CHIFFRES CLÉS ---
        const y0 = 22;
        const nomA = document.getElementById('comp-a-nom')?.textContent || 'Commune A';
        const nomB = document.getElementById('comp-b-nom')?.textContent || 'Commune B';
        // Nettoyer les nombres pour jsPDF (remplacer espaces insécables)
        const cleanNum = (id) => (document.getElementById(id)?.textContent || '—').replace(/\s/g, ' ').replace(/\u202f/g, ' ');

        const stats = modeAffichagePrincipal === 'stock' ? [
            { label: 'Établissements actifs', val: cleanNum('stock-total'), color: bleu },
        ] : modeAffichagePrincipal === 'comparaison' ? [
            { label: nomA, val: cleanNum('comp-a-total'), color: bleu },
            { label: nomB, val: cleanNum('comp-b-total'), color: [255,152,0] },
            { label: `Survie ${nomA}`, val: cleanNum('comp-a-survie'), color: bleu },
            { label: `Survie ${nomB}`, val: cleanNum('comp-b-survie'), color: [255,152,0] },
        ] : [
            { label: 'Établissements', val: cleanNum('an-total'), color: bleu },
            { label: 'Créations',      val: cleanNum('an-creations'), color: [76,175,80] },
            { label: 'Cessations',     val: cleanNum('an-cessations'), color: [244,67,54] },
            { label: 'Solde net',      val: cleanNum('an-solde'), color: [74,144,217] },
        ];

        const statW = (W - 2 * marge) / stats.length;
        stats.forEach((s, i) => {
            const x = marge + i * statW;
            doc.setFillColor(...gris);
            doc.roundedRect(x, y0, statW - 2, 16, 2, 2, 'F');
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...s.color);
            doc.text(s.val, x + statW/2 - 1, y0 + 9, { align: 'center' });
            doc.setFontSize(6);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(136, 146, 164);
            doc.text(s.label.toUpperCase(), x + statW/2 - 1, y0 + 14, { align: 'center' });
        });

        // --- CARTE --- via canvas MapLibre directement
        const mapCanvas = map.getCanvas();
        const mapImg = mapCanvas.toDataURL('image/jpeg', 0.85);

        const carteX = marge;
        const carteY = y0 + 19;
        const carteW = 130;
        const carteH = 130;

        doc.addImage(mapImg, 'JPEG', carteX, carteY, carteW, carteH);
        doc.setDrawColor(...gris);
        doc.rect(carteX, carteY, carteW, carteH);

        // Légende comparaison sous la carte
        if (modeAffichagePrincipal === 'comparaison') {
            const legY = carteY + carteH + 3;
            doc.setFillColor(74, 144, 217);
            doc.rect(carteX, legY, 5, 3, 'F');
            doc.setFontSize(7);
            doc.setTextColor(...texte);
            doc.text(nomA, carteX + 7, legY + 2.5);
            doc.setFillColor(255, 152, 0);
            doc.rect(carteX + 50, legY, 5, 3, 'F');
            doc.text(nomB, carteX + 57, legY + 2.5);
        }

        // --- GRAPHIQUES ---
        const graphX = marge + carteW + 4;
        const graphW = W - graphX - marge;
        const graphiques = modeAffichagePrincipal === 'stock'
            ? ['chart-secteurs-stock', 'chart-communes-stock', 'chart-anciennete', 'chart-effectif-stock']
            : modeAffichagePrincipal === 'comparaison'
            ? ['chart-comp-evolution', 'chart-comp-secteurs']
            : ['chart-evolution', 'chart-secteurs', 'chart-communes', 'chart-solde-secteur'];

        const graphH = (carteH - 6) / 2;
        const graphGap = 3;

        for (let i = 0; i < Math.min(graphiques.length, 4); i++) {
            const canvas = document.getElementById(graphiques[i]);
            if (!canvas) continue;
            const col = i % 2;
            const row = Math.floor(i / 2);
            const gw = (graphW - graphGap) / 2;
            const gx = graphX + col * (gw + graphGap);
            const gy = carteY + row * (graphH + graphGap);

            doc.setFillColor(...gris);
            doc.roundedRect(gx, gy, gw, graphH, 1, 1, 'F');

            try {
                const imgData = canvas.toDataURL('image/png');
                doc.addImage(imgData, 'PNG', gx + 2, gy + 2, gw - 4, graphH - 4);
            } catch(e) { console.log('Graphique ignoré:', graphiques[i], e); }
        }

        // --- PIED DE PAGE ---
        doc.setFillColor(...gris);
        doc.rect(0, H - 14, W, 14, 'F');

        doc.setFontSize(7);
        doc.setTextColor(136, 146, 164);
        doc.text('Données issues de la Base Sirene (INSEE) et du Bodacc — non officielles, à titre indicatif uniquement.', marge, H - 8);
        doc.setTextColor(...bleu);
        doc.text('cartonicolasrey.duckdns.org/portfolio/', W - marge, H - 8, { align: 'right' });

        // --- SAUVEGARDE PDF ---
        const nomFichier = `DynEco_${modeStr.replace(' ', '_')}_${dateStr.replace(/ /g, '-')}.pdf`;
        doc.save(nomFichier);

        // --- EXPORT CSV ---
        await exporterCSV(modeStr, dateStr);

    } catch(e) {
        console.error('Erreur export PDF:', e);
        alert('Erreur lors de la génération du PDF');
    } finally {
        btn.textContent = '📄 Exporter PDF + CSV';
        btn.disabled = false;
    }
}

// --- COMPARAISON ---
let chartCompEvolution = null;
let chartCompSecteurs  = null;

async function initComparaisonSelects() {
    // Peupler les selects EPCI pour la comparaison
    const selectsEpci = ['comp-epci-a', 'comp-epci-b'];
    selectsEpci.forEach(id => {
        const sel = document.getElementById(id);
        if (sel.options.length <= 1) {
            epcisGeoCache.features.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f.properties.code_epci;
                opt.textContent = f.properties.nom_epci;
                sel.appendChild(opt);
            });
        }
    });

    // Listeners pour charger les communes
    ['a', 'b'].forEach(side => {
        document.getElementById(`comp-epci-${side}`).addEventListener('change', async (e) => {
            const code = e.target.value;
            const sel  = document.getElementById(`comp-commune-${side}`);
            sel.innerHTML = `<option value="">Commune ${side.toUpperCase()}...</option>`;
            if (code) {
                const res = await fetch(`api/communes_epci/${code}`);
                const communes = await res.json();
                communes.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c.code_commune;
                    opt.textContent = c.nom_commune;
                    sel.appendChild(opt);
                });
            }
        });
    });
}

async function appliquerComparaison() {
    const communeA = document.getElementById('comp-commune-a').value;
    const communeB = document.getElementById('comp-commune-b').value;

    if (!communeA || !communeB) {
        alert('Veuillez sélectionner les deux communes à comparer.');
        return;
    }

    const btn = document.getElementById('btn-appliquer');
    btn.textContent = 'Chargement...';
    btn.disabled = true;

    try {
        const types  = Array.from(document.querySelectorAll('#filtre-evenements input:checked')).map(cb => cb.value);
        const periode = getParamsPeriode();

        const params = new URLSearchParams();
        params.set('commune_a', communeA);
        params.set('commune_b', communeB);
        Object.entries(periode).forEach(([k,v]) => params.set(k, v));
        types.forEach(t => params.append('types', t));

        const res  = await fetch(`api/comparaison?${params}`);
        const data = await res.json();

        const a = data.commune_a;
        const b = data.commune_b;

        if (!a || !b) return;

        // Stats header
        document.getElementById('comp-a-nom').textContent   = a.nom;
        document.getElementById('comp-b-nom').textContent   = b.nom;
        document.getElementById('comp-a-survie-nom').textContent = a.nom;
        document.getElementById('comp-b-survie-nom').textContent = b.nom;

        const totalA = a.evolution.reduce((s,r) => s + r.nb, 0);
        const totalB = b.evolution.reduce((s,r) => s + r.nb, 0);
        document.getElementById('comp-a-total').textContent = totalA.toLocaleString('fr-FR');
        document.getElementById('comp-b-total').textContent = totalB.toLocaleString('fr-FR');
        document.getElementById('comp-a-survie').textContent = `${a.taux_survie}%`;
        document.getElementById('comp-b-survie').textContent = `${b.taux_survie}%`;

        // Graphique évolution
        const ad = parseInt(periode.annee_debut), af = parseInt(periode.annee_fin);
        const labels = [];
        for (let y = ad; y <= af; y++) labels.push(y);

        const TYPE_COLORS_A = { creation: '#4CAF5099', cessation: '#4a90d999' };
        const TYPE_COLORS_B = { creation: '#FF980099', cessation: '#FF572299' };

        const datasets = [];
        const typesUniques = [...new Set([...a.evolution, ...b.evolution].map(r => r.type_evenement))];

        typesUniques.forEach(type => {
            const dataA = labels.map(y => {
                const r = a.evolution.find(r => r.annee === y && r.type_evenement === type);
                return r ? r.nb : 0;
            });
            const dataB = labels.map(y => {
                const r = b.evolution.find(r => r.annee === y && r.type_evenement === type);
                return r ? r.nb : 0;
            });
            datasets.push({
                label: `${a.nom} - ${type}`,
                data: dataA,
                backgroundColor: TYPE_COLORS_A[type] || '#4a90d999',
                borderColor: TYPE_COLORS_A[type]?.replace('99','') || '#4a90d9',
                borderWidth: 1
            });
            datasets.push({
                label: `${b.nom} - ${type}`,
                data: dataB,
                backgroundColor: TYPE_COLORS_B[type] || '#FF980099',
                borderColor: TYPE_COLORS_B[type]?.replace('99','') || '#FF9800',
                borderWidth: 1
            });
        });

        if (chartCompEvolution) chartCompEvolution.destroy();
        chartCompEvolution = new Chart(document.getElementById('chart-comp-evolution').getContext('2d'), {
            type: 'bar',
            data: { labels, datasets },
            options: { responsive: true,
                plugins: { legend: { labels: { color: '#e8eaf0', font: { size: 9 } } } },
                scales: { x: { ticks: { color: '#8892a4', font: { size: 9 } }, grid: { color: '#2e3650' } },
                          y: { ticks: { color: '#8892a4', font: { size: 9 } }, grid: { color: '#2e3650' } } } }
        });

        // Graphique secteurs
        const allSecteurs = [...new Set([...a.secteurs, ...b.secteurs].map(r => r.section_naf))];
        const secDataA = allSecteurs.map(s => a.secteurs.find(r => r.section_naf === s)?.nb || 0);
        const secDataB = allSecteurs.map(s => b.secteurs.find(r => r.section_naf === s)?.nb || 0);

        if (chartCompSecteurs) chartCompSecteurs.destroy();
        chartCompSecteurs = new Chart(document.getElementById('chart-comp-secteurs').getContext('2d'), {
            type: 'bar',
            data: {
                labels: allSecteurs.map(s => LABELS_NAF[s] || s),
                datasets: [
                    { label: a.nom, data: secDataA, backgroundColor: '#4a90d999', borderColor: '#4a90d9', borderWidth: 1 },
                    { label: b.nom, data: secDataB, backgroundColor: '#FF980099', borderColor: '#FF9800', borderWidth: 1 }
                ]
            },
            options: { indexAxis: 'y', responsive: true,
                plugins: { legend: { labels: { color: '#e8eaf0', font: { size: 9 } } } },
                scales: { x: { ticks: { color: '#8892a4', font: { size: 9 } }, grid: { color: '#2e3650' } },
                          y: { ticks: { color: '#8892a4', font: { size: 9 } }, grid: { color: '#2e3650' } } } }
        });

        // Carte - afficher les deux communes
        afficherCartComparaison(communeA, communeB, a.nom, b.nom);

    } catch(e) {
        console.error('Erreur comparaison:', e);
    } finally {
        btn.textContent = 'Appliquer';
        btn.disabled = false;
    }
}

function afficherCartComparaison(codeA, codeB, nomA, nomB) {
    // Colorier les communes sur la carte
    const updatedFeatures = communesGeoCache.features.map(f => ({
        ...f,
        properties: {
            ...f.properties,
            comp_color: f.properties.code_commune === codeA ? 1 :
                        f.properties.code_commune === codeB ? 2 : 0
        }
    }));
    map.getSource('communes').setData({ ...communesGeoCache, features: updatedFeatures });

    map.setPaintProperty('communes-fill', 'fill-color', [
        'match', ['get', 'comp_color'],
        1, '#4a90d9',
        2, '#FF9800',
        '#1e2a3a'
    ]);
    map.setPaintProperty('communes-fill', 'fill-opacity', 0.6);
    map.setPaintProperty('communes-choro', 'fill-opacity', 0);
    map.setLayoutProperty('etablissements-points', 'visibility', 'none');

    // Centrer sur les deux communes
    const fA = communesGeoCache.features.find(f => f.properties.code_commune === codeA);
    const fB = communesGeoCache.features.find(f => f.properties.code_commune === codeB);
    if (fA && fB) {
        const bA = getBoundsFromGeometry(fA.geometry);
        const bB = getBoundsFromGeometry(fB.geometry);
        if (bA && bB) {
            const bounds = [
                [Math.min(bA[0][0], bB[0][0]), Math.min(bA[0][1], bB[0][1])],
                [Math.max(bA[1][0], bB[1][0]), Math.max(bA[1][1], bB[1][1])]
            ];
            map.fitBounds(bounds, { padding: 60, duration: 800 });
        }
    }
}

// --- EXPORT CSV ---
async function exporterCSV(modeStr, dateStr) {
    try {
        let rows = [];
        let filename = `DynEco_${modeStr.replace(' ', '_')}_${dateStr.replace(/ /g, '-')}.csv`;

        if (modeAffichagePrincipal === 'comparaison') {
            // Export liste détaillée des établissements des deux communes
            const communeA = document.getElementById('comp-commune-a').value;
            const communeB = document.getElementById('comp-commune-b').value;
            const types    = Array.from(document.querySelectorAll('#filtre-evenements input:checked')).map(cb => cb.value);
            const periode  = getParamsPeriode();

            rows.push(['SIRET', 'Nom', 'Adresse', 'Code NAF', 'Activité', 'Secteur', 'Effectif', 'État', 'Date création', 'Date fermeture', 'Commune', 'EPCI']);

            for (const codeCommune of [communeA, communeB]) {
                const params = new URLSearchParams();
                params.set('code_commune', codeCommune);
                Object.entries(periode).forEach(([k,v]) => params.set(k, v));
                types.forEach(t => params.append('types', t));

                const res  = await fetch(`api/etablissements?${params}&limit=10000`);
                const data = await res.json();

                data.features.forEach(f => {
                    const p = f.properties;
                    rows.push([
                        p.siret, p.nom || 'N/A', p.adresse || '',
                        p.code_naf || '', p.libelle_naf || LABELS_NAF[p.section_naf] || '',
                        p.section_naf || '', p.tranche_effectif || '',
                        p.etat_admin === 'A' ? 'Actif' : 'Fermé',
                        p.date_creation || '', p.date_fermeture || '',
                        p.nom_commune || '', p.nom_epci || ''
                    ]);
                });
            }

        } else if (modeAffichagePrincipal === 'stock') {
            // Export établissements actifs
            const epci    = document.getElementById('filtre-epci').value;
            const commune = document.getElementById('filtre-commune').value;
            const naf     = document.getElementById('filtre-naf').value;
            const params  = new URLSearchParams();
            if (commune)   params.set('code_commune', commune);
            else if (epci) params.set('code_epci', epci);
            if (naf)       params.set('section_naf', naf);

            const res  = await fetch(`api/stock_actuel?${params}`);
            const data = await res.json();

            rows.push(['SIRET', 'Nom', 'Adresse', 'Code NAF', 'Activité', 'Secteur', 'Effectif', 'Date création', 'Commune', 'EPCI']);
            data.features.forEach(f => {
                const p = f.properties;
                rows.push([
                    p.siret, p.nom || 'N/A', p.adresse || '',
                    p.code_naf || '', p.libelle_naf || LABELS_NAF[p.section_naf] || '',
                    p.section_naf || '', p.tranche_effectif || '',
                    p.date_creation || '', p.nom_commune || '', p.nom_epci || ''
                ]);
            });

        } else {
            // Export établissements analyse temporelle
            const res  = await fetch(`api/etablissements?${buildParams()}&limit=10000`);
            const data = await res.json();

            rows.push(['SIRET', 'Nom', 'Adresse', 'Code NAF', 'Activité', 'Secteur', 'Effectif', 'État', 'Date création', 'Date fermeture', 'Commune', 'EPCI']);
            data.features.forEach(f => {
                const p = f.properties;
                rows.push([
                    p.siret, p.nom || 'N/A', p.adresse || '',
                    p.code_naf || '', p.libelle_naf || LABELS_NAF[p.section_naf] || '',
                    p.section_naf || '', p.tranche_effectif || '',
                    p.etat_admin === 'A' ? 'Actif' : 'Fermé',
                    p.date_creation || '', p.date_fermeture || '',
                    p.nom_commune || '', p.nom_epci || ''
                ]);
            });
        }

        // Générer le CSV
        const csvContent = rows.map(row =>
            row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';')
        ).join('\n');

        const bom = '\uFEFF'; // BOM UTF-8 pour Excel
        const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);

    } catch(e) {
        console.error('Erreur export CSV:', e);
    }
}

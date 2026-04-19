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

const SEUIL_POINTS = 8000; // en dessous -> points directs, au dessus -> choroplèthe

let modeColor    = 'etat_admin';
let modePeriode  = 'annee';
let modeAffichage = 'points'; // 'points' ou 'choro'
let currentFiltres = {};
let chartEvolution = null;
let chartSecteurs  = null;
let chartCommunes  = null;
let sectionsNaf    = {};
let communesGeoCache = null;
let epcisGeoCache    = null;
let moveTimer = null;

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
    const bornesRes = await fetch('/api/bornes_periode');
    const bornes = await bornesRes.json();

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

    // Source communes avec propriétés stats (pour choroplèthe)
    map.addSource('communes', { type: 'geojson', data: communesGeoCache });

    // Couche choroplèthe (masquée par défaut)
    map.addLayer({
        id: 'communes-choro', type: 'fill', source: 'communes',
        paint: { 'fill-color': '#1e2a3a', 'fill-opacity': 0 }
    });

    // Contours communes
    map.addLayer({
        id: 'communes-fill', type: 'fill', source: 'communes',
        paint: { 'fill-color': '#1e2a3a', 'fill-opacity': 0.6 }
    });
    map.addLayer({
        id: 'communes-stroke', type: 'line', source: 'communes',
        paint: { 'line-color': '#2e4a6a', 'line-width': 0.5 }
    });

    // EPCI
    map.addSource('epcis', { type: 'geojson', data: epcisGeoCache });
    map.addLayer({
        id: 'epcis-stroke', type: 'line', source: 'epcis',
        paint: { 'line-color': '#4a90d9', 'line-width': 2 }
    });

    // Points établissements
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

    // Popup établissements
    const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '320px' });
    map.on('click', 'etablissements-points', (e) => {
        const p = e.features[0].properties;
        const etatLabel = p.etat_admin === 'A' ? '🟢 Actif' : '🔴 Fermé';
        const dateCreation  = p.date_creation  ? p.date_creation.substring(0,10)  : null;
        const dateFermeture = p.date_fermeture ? p.date_fermeture.substring(0,10) : null;
        let contexte = '';
        if (dateCreation && dateFermeture) {
            contexte = `<div class="popup-contexte">⚠️ Créé le ${dateCreation}, fermé le ${dateFermeture}</div>`;
        } else if (dateCreation && p.etat_admin === 'F') {
            contexte = `<div class="popup-contexte">🔴 Créé le ${dateCreation} — fermé depuis</div>`;
        } else if (dateCreation) {
            contexte = `<div class="popup-contexte">🟢 Créé le ${dateCreation} — toujours actif</div>`;
        }

        // Note Bodacc si décalage entre événement et état Sirene
        let noteBodacc = '';
        if (p.dernier_evenement === 'liquidation' && p.etat_admin === 'A') {
            noteBodacc = `<div class="popup-note">⚠️ Annonce de liquidation publiée au Bodacc — état Sirene pas encore mis à jour</div>`;
        } else if (p.dernier_evenement === 'redressement' && p.etat_admin === 'A') {
            noteBodacc = `<div class="popup-note">ℹ️ Procédure de redressement publiée au Bodacc</div>`;
        } else if (p.dernier_evenement === 'liquidation' && p.etat_admin === 'F') {
            noteBodacc = `<div class="popup-note">🔴 Liquidation judiciaire — établissement fermé</div>`;
        }
        popup.setLngLat(e.lngLat).setHTML(`
            <div class="popup-content">
                <div class="popup-titre">${p.nom}</div>
                <div class="popup-etat">${etatLabel}</div>
                ${contexte}
                ${noteBodacc}
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

    // Hover communes
    map.on('mousemove', 'communes-choro', (e) => {
        if (e.features.length > 0) {
            const p = e.features[0].properties;
            const solde = p.solde || 0;
            const signe = solde >= 0 ? '+' : '';
            showTooltip(e.lngLat, `
                <strong>${p.nom_commune}</strong><br>
                🟢 ${p.nb_creations || 0} créations —
                🔴 ${p.nb_cessations || 0} cessations<br>
                <strong>Solde : ${signe}${solde}</strong>
            `);
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

    // Le moveend est géré par le listener global en bas du fichier

    // Selects
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

    Object.entries(sectionsNaf).forEach(([code, libelle]) => {
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = `${code} — ${libelle}`;
        document.getElementById('filtre-naf').appendChild(opt);
    });

    document.getElementById('btn-appliquer').addEventListener('click', appliquerFiltres);

    // Initialiser les fonds de carte
    await initFondCarte();

    appliquerFiltres();
});

async function appliquerFiltres() {
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

    // Stocker les filtres courants
    currentFiltres = {};
    if (commune)      currentFiltres.code_commune = commune;
    else if (epci)    currentFiltres.code_epci = epci;
    if (naf)          currentFiltres.section_naf = naf;
    Object.entries(periode).forEach(([k,v]) => currentFiltres[k] = v);
    if (types.length) currentFiltres.types = types;

    // Charger stats pour les graphiques
    const statsRes  = await fetch(`/api/stats?${buildParams()}`);
    const statsData = await statsRes.json();

    // Compter les établissements pour décider du mode d'affichage
    const countRes  = await fetch(`/api/count_etablissements?${buildParams()}`);
    const countData = await countRes.json();
    const nb        = countData.count;

    mettreAJourIndicateur(nb);

    // Si filtre commune -> toujours points directs (commune = zone petite)
    // Si filtre EPCI ou rien -> décider selon le count
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
    recentrerCarte(epci, commune);

    } catch(e) {
        console.error('Erreur appliquerFiltres:', e);
    } finally {
        btn.textContent = 'Appliquer';
        btn.disabled = false;
    }
}

async function chargerPointsDirects() {
    modeAffichage = 'points';
    map.setPaintProperty('communes-choro', 'fill-opacity', 0);
    map.setPaintProperty('communes-fill', 'fill-opacity', 0.6);
    map.setLayoutProperty('etablissements-points', 'visibility', 'visible');

    const res  = await fetch(`/api/etablissements?${buildParams()}&limit=2000`);
    const data = await res.json();
    map.getSource('etablissements').setData(data);
    appliquerCouleurs();
}

async function chargerPointsBbox() {
    const bounds = map.getBounds();
    // On garde le filtre géo (epci/commune) + on ajoute la bbox
    // La bbox sert uniquement à limiter le nb de points chargés
    // mais on reste dans le périmètre du filtre géo
    const extra  = {
        min_lon: bounds.getWest(),
        min_lat: bounds.getSouth(),
        max_lon: bounds.getEast(),
        max_lat: bounds.getNorth()
    };
    // buildParams inclut déjà code_epci ou code_commune depuis currentFiltres
    const params = buildParams(extra);
    const res    = await fetch(`/api/etablissements_bbox?${params}`);
    const data   = await res.json();
    map.getSource('etablissements').setData(data);
    appliquerCouleurs();
    document.getElementById('stat-total').textContent = `${data.total.toLocaleString('fr-FR')} établissements (vue)`;
}

async function afficherChoroplèthe(types) {
    map.setLayoutProperty('etablissements-points', 'visibility', 'none');
    map.setPaintProperty('communes-fill', 'fill-opacity', 0);

    const res            = await fetch(`/api/stats_communes?${buildParams()}`);
    const statsParCommune = await res.json();

    // Injecter les stats dans les features communes
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

    // Choisir la variable et la palette selon les types cochés
    const onlyCreations  = types.includes('creation')  && !types.includes('cessation');
    const onlyCessations = types.includes('cessation') && !types.includes('creation');

    let colorExpr;
    const valeurs = Object.values(statsParCommune);
    const maxVal  = Math.max(...valeurs.map(r => Math.max(r.nb_creations, r.nb_cessations, Math.abs(r.solde))), 1);

    if (onlyCreations) {
        // Blanc → vert foncé selon nb_creations
        colorExpr = ['interpolate', ['linear'], ['get', 'nb_creations'],
            0,            '#1e2a3a',
            maxVal * 0.1, '#a5d6a7',
            maxVal * 0.4, '#43a047',
            maxVal,       '#1b5e20'
        ];
    } else if (onlyCessations) {
        // Blanc → bleu foncé selon nb_cessations
        colorExpr = ['interpolate', ['linear'], ['get', 'nb_cessations'],
            0,            '#1e2a3a',
            maxVal * 0.1, '#90caf9',
            maxVal * 0.4, '#1e88e5',
            maxVal,       '#0d47a1'
        ];
    } else {
        // Solde net : rouge (négatif) → neutre → vert (positif)
        const maxSolde = Math.max(...valeurs.map(r => Math.abs(r.solde)), 1);
        colorExpr = ['interpolate', ['linear'], ['get', 'solde'],
            -maxSolde,       '#7f0000',
            -maxSolde * 0.3, '#e53935',
            0,               '#37474f',
            maxSolde * 0.3,  '#43a047',
            maxSolde,        '#1b5e20'
        ];
    }

    map.setPaintProperty('communes-choro', 'fill-color', colorExpr);
    map.setPaintProperty('communes-choro', 'fill-opacity', 0.8);

    // Bouton zoom-in pour passer en points
    mettreAJourIndicateur(null, true);
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

// Listener unique pour gérer la bascule choro <-> points selon zoom
map.on('moveend', async () => {
    if (Object.keys(currentFiltres).length === 0) return;
    if (modeAffichage === 'points') return; // points directs -> pas de bascule
    if (moveTimer) clearTimeout(moveTimer);

    moveTimer = setTimeout(async () => {
        const bounds = map.getBounds();
        const bboxOnly = new URLSearchParams({
            min_lon: bounds.getWest(),
            min_lat: bounds.getSouth(),
            max_lon: bounds.getEast(),
            max_lat: bounds.getNorth(),
            mode: currentFiltres.mode || 'annee',
            annee_debut: currentFiltres.annee_debut || '2020',
            annee_fin: currentFiltres.annee_fin || '2025'
        });
        if (currentFiltres.types) {
            const t = Array.isArray(currentFiltres.types) ? currentFiltres.types : [currentFiltres.types];
            t.forEach(v => bboxOnly.append('types', v));
        }
        // Count dans la bbox visible SANS filtre geo (pour décider choro vs points)
        const res  = await fetch(`/api/count_etablissements?${bboxOnly}`);
        const data = await res.json();
        console.log('moveend:', modeAffichage, '| count bbox:', data.count, '| seuil:', SEUIL_POINTS);

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

function mettreAJourStats(nb, statsData) {
    const creations  = statsData.total_creations;
    const cessations = statsData.total_cessations;
    const solde      = statsData.solde_periode;
    const actifs     = statsData.nb_actifs     || 0;
    const fermes     = statsData.nb_fermes     || 0;

    // Panel analyses : événements sur la période
    document.getElementById('an-total').textContent      = (nb || 0).toLocaleString('fr-FR');
    document.getElementById('an-creations').textContent  = creations.toLocaleString('fr-FR');
    document.getElementById('an-cessations').textContent = cessations.toLocaleString('fr-FR');

    const soldeEl = document.getElementById('an-solde');
    soldeEl.textContent = (solde >= 0 ? '+' : '') + solde.toLocaleString('fr-FR');
    soldeEl.className   = 'stat-valeur ' + (solde >= 0 ? 'vert' : 'rouge');

    // Header : état actuel des établissements filtrés
    document.getElementById('stat-total').textContent  = `${(nb || 0).toLocaleString('fr-FR')} établissements`;
    document.getElementById('stat-actifs').textContent = `${actifs.toLocaleString('fr-FR')} actifs`;
    document.getElementById('stat-fermes').textContent = `${fermes.toLocaleString('fr-FR')} fermés`;
}

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
    const today   = new Date();
    const dateStr = today.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    legende.innerHTML = '';

    if (modeAffichage === 'choro') {
        const types = Array.isArray(currentFiltres.types) ? currentFiltres.types : [currentFiltres.types].filter(Boolean);
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
    // Source IGN Plan
    map.addSource('ign-plan', {
        type: 'raster',
        tiles: ['https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'],
        tileSize: 256,
        attribution: '© IGN'
    });

    // Source IGN Orthophoto
    map.addSource('ign-ortho', {
        type: 'raster',
        tiles: ['https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'],
        tileSize: 256,
        attribution: '© IGN'
    });

    // Couches raster insérées SOUS communes-choro
    map.addLayer({
        id: 'fond-plan',
        type: 'raster',
        source: 'ign-plan',
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 1 }
    }, 'communes-choro');

    map.addLayer({
        id: 'fond-ortho',
        type: 'raster',
        source: 'ign-ortho',
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 1 }
    }, 'communes-choro');

    // Masque hors zone inséré APRES les fonds mais AVANT les communes
    await chargerMasqueZone();
}

async function chargerMasqueZone() {
    if (masqueZoneCharge) return;

    // Récupérer les géométries EPCI pour construire le masque
    const res  = await fetch('/api/epcis');
    const data = await res.json();

    // Construire un polygone "monde entier moins nos EPCI"
    const monde = [[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]];

    // Fusionner toutes les géométries EPCI en un seul multipolygone
    const trous = [];
    data.features.forEach(f => {
        const geom = f.geometry;
        if (geom.type === 'Polygon') {
            trous.push(geom.coordinates[0]);
        } else if (geom.type === 'MultiPolygon') {
            geom.coordinates.forEach(poly => trous.push(poly[0]));
        }
    });

    const masqueGeojson = {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [monde, ...trous]
            },
            properties: {}
        }]
    };

    map.addSource('masque-zone', { type: 'geojson', data: masqueGeojson });
    // Insérer le masque APRES les fonds IGN mais AVANT les communes
    map.addLayer({
        id: 'masque-zone-fill',
        type: 'fill',
        source: 'masque-zone',
        paint: {
            'fill-color': '#0f1118',
            'fill-opacity': 1
        }
    }, 'communes-choro'); // sous les communes

    masqueZoneCharge = true;
}

function setFond(type) {
    fondActuel = type;

    // Mettre à jour les boutons
    document.querySelectorAll('.fond-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-fond-${type}`).classList.add('active');

    // Afficher/masquer les couches
    map.setLayoutProperty('fond-plan',  'visibility', type === 'plan'  ? 'visible' : 'none');
    map.setLayoutProperty('fond-ortho', 'visibility', type === 'ortho' ? 'visible' : 'none');

    // Adapter l'opacité du fond sombre selon le fond choisi
    if (type === 'aucun') {
        map.setPaintProperty('communes-fill', 'fill-color', '#1e2a3a');
        map.setPaintProperty('communes-fill', 'fill-opacity', 0.6);
        map.setPaintProperty('background', 'background-color', '#0f1118');
    } else if (type === 'ortho') {
        // Orthophoto : communes transparentes pour voir le fond
        map.setPaintProperty('communes-fill', 'fill-opacity', 0);
        map.setPaintProperty('background', 'background-color', '#0f1118');
    } else {
        // Plan IGN : communes semi-transparentes
        map.setPaintProperty('communes-fill', 'fill-color', '#1e2a3a');
        map.setPaintProperty('communes-fill', 'fill-opacity', 0.1);
        map.setPaintProperty('background', 'background-color', '#0f1118');
    }
}



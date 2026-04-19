from flask import Blueprint, render_template, jsonify, request
import psycopg2
import psycopg2.extras
import os

main = Blueprint('main', __name__)

def get_db():
    return psycopg2.connect(os.getenv('DATABASE_URL'))

@main.route('/')
def index():
    return render_template('index.html')

@main.route('/api/health')
def health():
    try:
        conn = get_db()
        conn.close()
        return jsonify({'status': 'ok', 'db': 'connected'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@main.route('/api/epcis')
def api_epcis():
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT code_epci, nom_epci, type_epci,
               ST_AsGeoJSON(geom)::json AS geometry
        FROM epci ORDER BY nom_epci
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    features = [{
        "type": "Feature",
        "properties": {
            "code_epci": r['code_epci'],
            "nom_epci": r['nom_epci'],
            "type_epci": r['type_epci']
        },
        "geometry": r['geometry']
    } for r in rows]
    return jsonify({"type": "FeatureCollection", "features": features})

@main.route('/api/communes')
def api_communes():
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT c.code_commune, c.nom_commune, c.code_epci, e.nom_epci,
               ST_AsGeoJSON(c.geom)::json AS geometry
        FROM communes c
        JOIN epci e ON c.code_epci = e.code_epci
        ORDER BY c.nom_commune
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    features = [{
        "type": "Feature",
        "properties": {
            "code_commune": r['code_commune'],
            "nom_commune": r['nom_commune'],
            "code_epci": r['code_epci'],
            "nom_epci": r['nom_epci']
        },
        "geometry": r['geometry']
    } for r in rows]
    return jsonify({"type": "FeatureCollection", "features": features})

@main.route('/api/communes_epci/<code_epci>')
def api_communes_by_epci(code_epci):
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT code_commune, nom_commune
        FROM communes WHERE code_epci = %s
        ORDER BY nom_commune
    """, (code_epci,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify([dict(r) for r in rows])

@main.route('/api/bornes_periode')
def api_bornes_periode():
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT
            MIN(annee) as min_annee,
            MAX(annee) as max_annee,
            MIN(trimestre) FILTER (WHERE annee = (SELECT MIN(annee) FROM evenements_etablissements)) as min_trim,
            MAX(trimestre) FILTER (WHERE annee = (SELECT MAX(annee) FROM evenements_etablissements)) as max_trim
        FROM evenements_etablissements
    """)
    r = cur.fetchone()
    cur.close()
    conn.close()
    return jsonify(dict(r))

def build_periode_condition(params_list, prefix='ev'):
    """
    Construit la condition temporelle selon le mode (annuel ou trimestriel).
    Retourne une condition SQL et ajoute les params nécessaires.
    """
    mode        = request.args.get('mode', 'annee')
    annee_debut = request.args.get('annee_debut', '2020')
    annee_fin   = request.args.get('annee_fin', '2025')
    trim_debut  = request.args.get('trim_debut', '1')
    trim_fin    = request.args.get('trim_fin', '4')

    if mode == 'trimestre':
        # Convertir en numéro de trimestre absolu pour comparaison
        # trimestre absolu = annee * 4 + trimestre
        params_list += [
            int(annee_debut) * 4 + int(trim_debut),
            int(annee_fin) * 4 + int(trim_fin)
        ]
        return f"({prefix}.annee * 4 + {prefix}.trimestre) BETWEEN %s AND %s"
    else:
        params_list += [int(annee_debut), int(annee_fin)]
        return f"{prefix}.annee BETWEEN %s AND %s"

def build_date_condition(params_list):
    """Condition sur date_creation des établissements"""
    mode        = request.args.get('mode', 'annee')
    annee_debut = request.args.get('annee_debut', '2020')
    annee_fin   = request.args.get('annee_fin', '2025')
    trim_debut  = request.args.get('trim_debut', '1')
    trim_fin    = request.args.get('trim_fin', '4')

    # Convertir trimestre en mois
    mois_debut = {1: '01', 2: '04', 3: '07', 4: '10'}
    mois_fin   = {1: '03', 2: '06', 3: '09', 4: '12'}

    if mode == 'trimestre':
        date_debut = f"{annee_debut}-{mois_debut[int(trim_debut)]}-01"
        date_fin   = f"{annee_fin}-{mois_fin[int(trim_fin)]}-31"
    else:
        date_debut = f"{annee_debut}-01-01"
        date_fin   = f"{annee_fin}-12-31"

    params_list += [date_debut, date_fin]
    return "e.date_creation BETWEEN %s AND %s"

def build_geo_filter(params_list):
    conditions = []
    code_commune = request.args.get('code_commune', '')
    code_epci    = request.args.get('code_epci', '')
    section_naf  = request.args.get('section_naf', '')

    if code_commune:
        conditions.append("e.code_commune = %s")
        params_list.append(code_commune)
    elif code_epci:
        conditions.append("c.code_epci = %s")
        params_list.append(code_epci)

    if section_naf:
        conditions.append("e.section_naf = %s")
        params_list.append(section_naf)

    return conditions

def build_type_filter(params_list, prefix='ev'):
    """Filtre sur les types d'événements cochés"""
    types = request.args.getlist('types')
    if not types:
        return None
    placeholders = ','.join(['%s'] * len(types))
    params_list += types
    return f"{prefix}.type_evenement IN ({placeholders})"

@main.route('/api/etablissements')
def api_etablissements():
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    params = []
    conditions = ["e.geom IS NOT NULL"]

    # Filtre géographique
    conditions += build_geo_filter(params)

    # Filtre type événement + période combinés
    # On filtre les établissements qui ont eu l'un des événements cochés sur la période
    types = request.args.getlist('types')
    if not types:
        types = ['creation', 'cessation']

    periode_cond_params = []
    periode_cond = build_periode_condition(periode_cond_params, prefix='ev')
    placeholders = ','.join(['%s'] * len(types))
    params_types = periode_cond_params + types
    conditions.append(f"""
        e.siret IN (
            SELECT DISTINCT ev.siret
            FROM evenements_etablissements ev
            WHERE {periode_cond}
            AND ev.type_evenement IN ({placeholders})
        )
    """)
    params += params_types

    where = " AND ".join(conditions)

    cur.execute(f"""
        SELECT
            e.siret, e.nom, e.adresse,
            e.code_naf, e.libelle_naf, e.section_naf,
            e.tranche_effectif, e.etat_admin,
            e.date_creation, e.date_fermeture, e.est_siege,
            c.nom_commune, c.code_commune, c.code_epci, ep.nom_epci,
            ST_AsGeoJSON(e.geom)::json AS geometry
        FROM etablissements e
        JOIN communes c ON e.code_commune = c.code_commune
        JOIN epci ep ON c.code_epci = ep.code_epci
        WHERE {where}
        LIMIT 10000
    """, params)

    rows = cur.fetchall()
    cur.close()
    conn.close()

    features = [{
        "type": "Feature",
        "properties": {
            "siret":            r['siret'],
            "nom":              r['nom'],
            "adresse":          r['adresse'],
            "code_naf":         r['code_naf'],
            "libelle_naf":      r['libelle_naf'],
            "section_naf":      r['section_naf'],
            "tranche_effectif": r['tranche_effectif'],
            "etat_admin":       r['etat_admin'],
            "date_creation":    str(r['date_creation']) if r['date_creation'] else None,
            "date_fermeture":   str(r['date_fermeture']) if r['date_fermeture'] else None,
            "est_siege":        r['est_siege'],
            "nom_commune":      r['nom_commune'],
            "code_commune":     r['code_commune'],
            "nom_epci":         r['nom_epci']
        },
        "geometry": r['geometry']
    } for r in rows]

    return jsonify({
        "type": "FeatureCollection",
        "features": features,
        "total": len(features)
    })

@main.route('/api/stats')
def api_stats():
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    code_commune = request.args.get('code_commune', '')
    code_epci    = request.args.get('code_epci', '')
    section_naf  = request.args.get('section_naf', '')
    mode         = request.args.get('mode', 'annee')
    types        = request.args.getlist('types') or ['creation', 'cessation']

    # --- Évolution ---
    params_evo = []
    cond_evo = []

    periode_cond = build_periode_condition(params_evo, prefix='ev')
    cond_evo.append(periode_cond)

    if code_commune:
        cond_evo.append("e.code_commune = %s")
        params_evo.append(code_commune)
    elif code_epci:
        cond_evo.append("c.code_epci = %s")
        params_evo.append(code_epci)
    if section_naf:
        cond_evo.append("e.section_naf = %s")
        params_evo.append(section_naf)

    # Filtre types
    placeholders = ','.join(['%s'] * len(types))
    cond_evo.append(f"ev.type_evenement IN ({placeholders})")
    params_evo += types

    if mode == 'trimestre':
        group_select = "ev.annee, ev.trimestre"
        order_by     = "ev.annee, ev.trimestre"
    else:
        group_select = "ev.annee"
        order_by     = "ev.annee"

    cur.execute(f"""
        SELECT {group_select}, ev.type_evenement, COUNT(*) as nb
        FROM evenements_etablissements ev
        JOIN etablissements e ON ev.siret = e.siret
        JOIN communes c ON e.code_commune = c.code_commune
        WHERE {" AND ".join(cond_evo)}
        GROUP BY {group_select}, ev.type_evenement
        ORDER BY {order_by}, ev.type_evenement
    """, params_evo)
    evolution = [dict(r) for r in cur.fetchall()]

    total_creations  = sum(r['nb'] for r in evolution if r['type_evenement'] == 'creation')
    total_cessations = sum(r['nb'] for r in evolution if r['type_evenement'] == 'cessation')
    solde_periode    = total_creations - total_cessations

    # --- Secteurs actifs ---
    params_sec = []
    cond_sec   = ["e.etat_admin = 'A'"]
    if code_commune:
        cond_sec.append("e.code_commune = %s"); params_sec.append(code_commune)
    elif code_epci:
        cond_sec.append("c.code_epci = %s"); params_sec.append(code_epci)
    if section_naf:
        cond_sec.append("e.section_naf = %s"); params_sec.append(section_naf)

    cur.execute(f"""
        SELECT e.section_naf, COUNT(*) as nb
        FROM etablissements e
        JOIN communes c ON e.code_commune = c.code_commune
        WHERE {" AND ".join(cond_sec)}
        GROUP BY e.section_naf ORDER BY nb DESC
    """, params_sec)
    secteurs = [dict(r) for r in cur.fetchall()]

    # --- Top communes ---
    top_communes = []
    if not code_commune and 'creation' in types:
        params_top = []
        cond_top   = [build_periode_condition(params_top, prefix='ev'),
                      "ev.type_evenement = 'creation'"]
        if code_epci:
            cond_top.append("c.code_epci = %s"); params_top.append(code_epci)
        if section_naf:
            cond_top.append("e.section_naf = %s"); params_top.append(section_naf)

        cur.execute(f"""
            SELECT c.nom_commune, COUNT(*) as nb_creations
            FROM evenements_etablissements ev
            JOIN etablissements e ON ev.siret = e.siret
            JOIN communes c ON e.code_commune = c.code_commune
            WHERE {" AND ".join(cond_top)}
            GROUP BY c.nom_commune
            ORDER BY nb_creations DESC LIMIT 8
        """, params_top)
        top_communes = [dict(r) for r in cur.fetchall()]

    cur.close()
    conn.close()

    return jsonify({
        "evolution":        evolution,
        "secteurs":         secteurs,
        "top_communes":     top_communes,
        "solde_periode":    solde_periode,
        "total_creations":  total_creations,
        "total_cessations": total_cessations,
        "mode":             mode
    })

@main.route('/api/sections_naf')
def api_sections_naf():
    sections = {
        'A': 'Agriculture, sylviculture et pêche',
        'B': 'Industries extractives',
        'C': "Industrie manufacturière",
        'D': "Production et distribution d'énergie",
        'E': 'Eau, assainissement, déchets',
        'F': 'Construction',
        'G': 'Commerce, réparation auto',
        'H': 'Transports et entreposage',
        'I': 'Hébergement et restauration',
        'J': 'Information et communication',
        'K': 'Activités financières',
        'L': 'Activités immobilières',
        'M': 'Activités spécialisées scientifiques',
        'N': 'Activités de services administratifs',
        'O': 'Administration publique',
        'P': 'Enseignement',
        'Q': 'Santé humaine et action sociale',
        'R': 'Arts, spectacles et activités récréatives',
        'S': 'Autres activités de services',
        'T': "Ménages en tant qu'employeurs",
        'U': 'Activités extra-territoriales'
    }
    return jsonify(sections)

@main.route('/api/stats_communes')
def api_stats_communes():
    """Agrégats par commune pour la choroplèthe"""
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    code_epci    = request.args.get('code_epci', '')
    code_commune = request.args.get('code_commune', '')
    section_naf  = request.args.get('section_naf', '')
    types        = request.args.getlist('types') or ['creation', 'cessation']

    params = []
    cond = []

    periode_cond = build_periode_condition(params, prefix='ev')
    cond.append(periode_cond)

    placeholders = ','.join(['%s'] * len(types))
    cond.append(f"ev.type_evenement IN ({placeholders})")
    params += types

    if code_commune:
        cond.append("e.code_commune = %s")
        params.append(code_commune)
    elif code_epci:
        cond.append("c.code_epci = %s")
        params.append(code_epci)

    if section_naf:
        cond.append("e.section_naf = %s")
        params.append(section_naf)

    cur.execute(f"""
        SELECT
            e.code_commune,
            c.nom_commune,
            COUNT(*) FILTER (WHERE ev.type_evenement = 'creation') as nb_creations,
            COUNT(*) FILTER (WHERE ev.type_evenement = 'cessation') as nb_cessations,
            COUNT(*) FILTER (WHERE ev.type_evenement = 'creation') -
            COUNT(*) FILTER (WHERE ev.type_evenement = 'cessation') as solde
        FROM evenements_etablissements ev
        JOIN etablissements e ON ev.siret = e.siret
        JOIN communes c ON e.code_commune = c.code_commune
        WHERE {" AND ".join(cond)}
        GROUP BY e.code_commune, c.nom_commune
    """, params)

    rows = cur.fetchall()
    cur.close()
    conn.close()

    return jsonify({r['code_commune']: dict(r) for r in rows})

@main.route('/api/etablissements_bbox')
def api_etablissements_bbox():
    """Établissements dans une bbox visible — pour zoom élevé"""
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        min_lon = float(request.args.get('min_lon'))
        min_lat = float(request.args.get('min_lat'))
        max_lon = float(request.args.get('max_lon'))
        max_lat = float(request.args.get('max_lat'))
    except (TypeError, ValueError):
        return jsonify({'error': 'bbox invalide'}), 400

    types   = request.args.getlist('types') or ['creation', 'cessation']
    section_naf = request.args.get('section_naf', '')

    params = []
    conditions = ["""
        e.geom IS NOT NULL AND
        e.geom && ST_MakeEnvelope(%s, %s, %s, %s, 4326)
    """]
    params += [min_lon, min_lat, max_lon, max_lat]

    periode_cond_params = []
    periode_cond = build_periode_condition(periode_cond_params, prefix='ev')
    placeholders = ','.join(['%s'] * len(types))
    conditions.append(f"""
        e.siret IN (
            SELECT DISTINCT ev.siret
            FROM evenements_etablissements ev
            WHERE {periode_cond}
            AND ev.type_evenement IN ({placeholders})
        )
    """)
    params += periode_cond_params + types

    if section_naf:
        conditions.append("e.section_naf = %s")
        params.append(section_naf)

    where = " AND ".join(conditions)

    cur.execute(f"""
        SELECT
            e.siret, e.nom, e.adresse,
            e.code_naf, e.libelle_naf, e.section_naf,
            e.tranche_effectif, e.etat_admin,
            e.date_creation, e.date_fermeture, e.est_siege,
            c.nom_commune, c.code_commune, c.code_epci, ep.nom_epci,
            ST_AsGeoJSON(e.geom)::json AS geometry
        FROM etablissements e
        JOIN communes c ON e.code_commune = c.code_commune
        JOIN epci ep ON c.code_epci = ep.code_epci
        WHERE {where}
        LIMIT 2000
    """, params)

    rows = cur.fetchall()
    cur.close()
    conn.close()

    features = [{
        "type": "Feature",
        "properties": {
            "siret":            r['siret'],
            "nom":              r['nom'],
            "adresse":          r['adresse'],
            "code_naf":         r['code_naf'],
            "libelle_naf":      r['libelle_naf'],
            "section_naf":      r['section_naf'],
            "tranche_effectif": r['tranche_effectif'],
            "etat_admin":       r['etat_admin'],
            "date_creation":    str(r['date_creation']) if r['date_creation'] else None,
            "date_fermeture":   str(r['date_fermeture']) if r['date_fermeture'] else None,
            "est_siege":        r['est_siege'],
            "nom_commune":      r['nom_commune'],
            "code_commune":     r['code_commune'],
            "nom_epci":         r['nom_epci']
        },
        "geometry": r['geometry']
    } for r in rows]

    return jsonify({
        "type": "FeatureCollection",
        "features": features,
        "total": len(features)
    })

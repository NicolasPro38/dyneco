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
    mode        = request.args.get('mode', 'annee')
    annee_debut = request.args.get('annee_debut', '2020')
    annee_fin   = request.args.get('annee_fin', '2025')
    trim_debut  = request.args.get('trim_debut', '1')
    trim_fin    = request.args.get('trim_fin', '4')
    if mode == 'trimestre':
        params_list += [int(annee_debut) * 4 + int(trim_debut), int(annee_fin) * 4 + int(trim_fin)]
        return f"({prefix}.annee * 4 + {prefix}.trimestre) BETWEEN %s AND %s"
    else:
        params_list += [int(annee_debut), int(annee_fin)]
        return f"{prefix}.annee BETWEEN %s AND %s"

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

@main.route('/api/etablissements')
def api_etablissements():
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    params = []
    conditions = ["e.geom IS NOT NULL"]
    conditions += build_geo_filter(params)

    types = request.args.getlist('types') or ['creation', 'cessation']
    periode_cond_params = []
    periode_cond = build_periode_condition(periode_cond_params, prefix='ev')
    placeholders = ','.join(['%s'] * len(types))
    conditions.append(f"""
        e.siret IN (
            SELECT DISTINCT ev.siret FROM evenements_etablissements ev
            WHERE {periode_cond}
            AND ev.type_evenement IN ({placeholders})
        )
    """)
    params += periode_cond_params + types

    where = " AND ".join(conditions)
    cur.execute(f"""
        SELECT e.siret, e.nom, e.adresse,
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
            "siret": r['siret'], "nom": r['nom'], "adresse": r['adresse'],
            "code_naf": r['code_naf'], "libelle_naf": r['libelle_naf'],
            "section_naf": r['section_naf'], "tranche_effectif": r['tranche_effectif'],
            "etat_admin": r['etat_admin'],
            "date_creation": str(r['date_creation']) if r['date_creation'] else None,
            "date_fermeture": str(r['date_fermeture']) if r['date_fermeture'] else None,
            "est_siege": r['est_siege'], "nom_commune": r['nom_commune'],
            "code_commune": r['code_commune'], "nom_epci": r['nom_epci']
        },
        "geometry": r['geometry']
    } for r in rows]

    return jsonify({"type": "FeatureCollection", "features": features, "total": len(features)})

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
    cond_evo   = [build_periode_condition(params_evo, prefix='ev')]
    if code_commune:
        cond_evo.append("e.code_commune = %s"); params_evo.append(code_commune)
    elif code_epci:
        cond_evo.append("c.code_epci = %s"); params_evo.append(code_epci)
    if section_naf:
        cond_evo.append("e.section_naf = %s"); params_evo.append(section_naf)
    placeholders = ','.join(['%s'] * len(types))
    cond_evo.append(f"ev.type_evenement IN ({placeholders})")
    params_evo += types

    group_select = "ev.annee, ev.trimestre" if mode == 'trimestre' else "ev.annee"
    order_by     = group_select

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
        cond_top   = [build_periode_condition(params_top, prefix='ev'), "ev.type_evenement = 'creation'"]
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

    # --- Actifs / Fermés sur la période ---
    params_etat = []
    cond_etat   = []
    if code_commune:
        cond_etat.append("e.code_commune = %s"); params_etat.append(code_commune)
    elif code_epci:
        cond_etat.append("c.code_epci = %s"); params_etat.append(code_epci)
    if section_naf:
        cond_etat.append("e.section_naf = %s"); params_etat.append(section_naf)

    periode_cond_etat_params = []
    periode_cond_etat = build_periode_condition(periode_cond_etat_params, prefix='ev')
    placeholders_etat = ','.join(['%s'] * len(types))
    cond_etat.append(f"""
        e.siret IN (
            SELECT DISTINCT ev.siret FROM evenements_etablissements ev
            WHERE {periode_cond_etat}
            AND ev.type_evenement IN ({placeholders_etat})
        )
    """)
    params_etat += periode_cond_etat_params + types
    where_etat = " AND ".join(cond_etat) if cond_etat else "1=1"

    cur.execute(f"""
        SELECT
            COUNT(*) FILTER (WHERE e.etat_admin = 'A') as nb_actifs,
            COUNT(*) FILTER (WHERE e.etat_admin = 'F') as nb_fermes
        FROM etablissements e
        JOIN communes c ON e.code_commune = c.code_commune
        WHERE {where_etat}
    """, params_etat)
    etat_row = cur.fetchone()

    cur.close()
    conn.close()

    return jsonify({
        "evolution":        evolution,
        "secteurs":         secteurs,
        "top_communes":     top_communes,
        "solde_periode":    solde_periode,
        "total_creations":  total_creations,
        "total_cessations": total_cessations,
        "mode":             mode,
        "nb_actifs":        etat_row['nb_actifs'] if etat_row else 0,
        "nb_fermes":        etat_row['nb_fermes'] if etat_row else 0
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
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    code_epci    = request.args.get('code_epci', '')
    code_commune = request.args.get('code_commune', '')
    section_naf  = request.args.get('section_naf', '')
    types        = request.args.getlist('types') or ['creation', 'cessation']

    params = []
    cond   = [build_periode_condition(params, prefix='ev')]
    placeholders = ','.join(['%s'] * len(types))
    cond.append(f"ev.type_evenement IN ({placeholders})")
    params += types

    if code_commune:
        cond.append("e.code_commune = %s"); params.append(code_commune)
    elif code_epci:
        cond.append("c.code_epci = %s"); params.append(code_epci)
    if section_naf:
        cond.append("e.section_naf = %s"); params.append(section_naf)

    cur.execute(f"""
        SELECT
            e.code_commune, c.nom_commune,
            COUNT(*) FILTER (WHERE ev.type_evenement = 'creation')  as nb_creations,
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
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        min_lon = float(request.args.get('min_lon'))
        min_lat = float(request.args.get('min_lat'))
        max_lon = float(request.args.get('max_lon'))
        max_lat = float(request.args.get('max_lat'))
    except (TypeError, ValueError):
        return jsonify({'error': 'bbox invalide'}), 400

    types        = request.args.getlist('types') or ['creation', 'cessation']
    section_naf  = request.args.get('section_naf', '')
    code_epci    = request.args.get('code_epci', '')
    code_commune = request.args.get('code_commune', '')

    params     = [min_lon, min_lat, max_lon, max_lat]
    conditions = ["e.geom IS NOT NULL AND e.geom && ST_MakeEnvelope(%s, %s, %s, %s, 4326)"]

    # Filtre géographique — on reste dans le périmètre sélectionné
    if code_commune:
        conditions.append("e.code_commune = %s")
        params.append(code_commune)
    elif code_epci:
        conditions.append("c.code_epci = %s")
        params.append(code_epci)

    periode_cond_params = []
    periode_cond = build_periode_condition(periode_cond_params, prefix='ev')
    placeholders = ','.join(['%s'] * len(types))
    conditions.append(f"""
        e.siret IN (
            SELECT DISTINCT ev.siret FROM evenements_etablissements ev
            WHERE {periode_cond}
            AND ev.type_evenement IN ({placeholders})
        )
    """)
    params += periode_cond_params + types

    if section_naf:
        conditions.append("e.section_naf = %s"); params.append(section_naf)

    where = " AND ".join(conditions)
    cur.execute(f"""
        SELECT e.siret, e.nom, e.adresse,
               e.code_naf, e.libelle_naf, e.section_naf,
               e.tranche_effectif, e.etat_admin,
               e.date_creation, e.date_fermeture, e.est_siege,
               c.nom_commune, c.code_commune, c.code_epci, ep.nom_epci,
               ST_AsGeoJSON(e.geom)::json AS geometry
        FROM etablissements e
        JOIN communes c ON e.code_commune = c.code_commune
        JOIN epci ep ON c.code_epci = ep.code_epci
        WHERE {where}
        LIMIT 8000
    """, params)

    rows = cur.fetchall()
    cur.close()
    conn.close()

    features = [{
        "type": "Feature",
        "properties": {
            "siret": r['siret'], "nom": r['nom'], "adresse": r['adresse'],
            "code_naf": r['code_naf'], "libelle_naf": r['libelle_naf'],
            "section_naf": r['section_naf'], "tranche_effectif": r['tranche_effectif'],
            "etat_admin": r['etat_admin'],
            "date_creation": str(r['date_creation']) if r['date_creation'] else None,
            "date_fermeture": str(r['date_fermeture']) if r['date_fermeture'] else None,
            "est_siege": r['est_siege'], "nom_commune": r['nom_commune'],
            "code_commune": r['code_commune'], "nom_epci": r['nom_epci']
        },
        "geometry": r['geometry']
    } for r in rows]

    return jsonify({"type": "FeatureCollection", "features": features, "total": len(features)})

@main.route('/api/count_etablissements')
def api_count_etablissements():
    conn = get_db()
    cur  = conn.cursor()

    code_epci    = request.args.get('code_epci', '')
    code_commune = request.args.get('code_commune', '')
    min_lon      = request.args.get('min_lon', '')
    min_lat      = request.args.get('min_lat', '')
    max_lon      = request.args.get('max_lon', '')
    max_lat      = request.args.get('max_lat', '')
    types        = request.args.getlist('types') or ['creation', 'cessation']

    params = []
    cond   = ["e.geom IS NOT NULL"]

    periode_cond_params = []
    periode_cond = build_periode_condition(periode_cond_params, prefix='ev')
    placeholders = ','.join(['%s'] * len(types))
    cond.append(f"""
        e.siret IN (
            SELECT DISTINCT ev.siret FROM evenements_etablissements ev
            WHERE {periode_cond}
            AND ev.type_evenement IN ({placeholders})
        )
    """)
    params += periode_cond_params + types

    # Filtre géographique : bbox prioritaire sur epci/commune
    if min_lon and min_lat and max_lon and max_lat:
        cond.append("e.geom && ST_MakeEnvelope(%s, %s, %s, %s, 4326)")
        params += [float(min_lon), float(min_lat), float(max_lon), float(max_lat)]
    elif code_commune:
        cond.append("e.code_commune = %s"); params.append(code_commune)
    elif code_epci:
        cond.append("c.code_epci = %s"); params.append(code_epci)

    cur.execute(f"""
        SELECT COUNT(*) as nb
        FROM etablissements e
        JOIN communes c ON e.code_commune = c.code_commune
        WHERE {" AND ".join(cond)}
    """, params)

    nb = cur.fetchone()[0]
    cur.close()
    conn.close()
    return jsonify({'count': nb})

@main.route('/api/taux_survie')
def api_taux_survie():
    """
    Taux de survie : parmi les établissements ayant eu
    un événement 'creation' sur la période filtrée,
    combien sont encore actifs aujourd'hui ?
    """
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    code_commune = request.args.get('code_commune', '')
    code_epci    = request.args.get('code_epci', '')
    section_naf  = request.args.get('section_naf', '')

    # Construire la condition période sur les événements de création
    params_periode = []
    periode_cond = build_periode_condition(params_periode, prefix='ev')

    cond = [
        periode_cond,
        "ev.type_evenement = 'creation'"
    ]
    params = params_periode

    if code_commune:
        cond.append("e.code_commune = %s"); params.append(code_commune)
    elif code_epci:
        cond.append("c.code_epci = %s"); params.append(code_epci)
    if section_naf:
        cond.append("e.section_naf = %s"); params.append(section_naf)

    cur.execute(f"""
        SELECT
            COUNT(DISTINCT e.siret) as total_crees,
            COUNT(DISTINCT e.siret) FILTER (WHERE e.etat_admin = 'A') as encore_actifs
        FROM evenements_etablissements ev
        JOIN etablissements e ON ev.siret = e.siret
        JOIN communes c ON e.code_commune = c.code_commune
        WHERE {" AND ".join(cond)}
    """, params)

    r = cur.fetchone()
    cur.close()
    conn.close()

    total  = r['total_crees'] or 0
    actifs = r['encore_actifs'] or 0
    fermes = total - actifs
    taux   = round(actifs / total * 100, 1) if total > 0 else 0

    return jsonify({
        'total_crees':   total,
        'encore_actifs': actifs,
        'nb_fermes':     fermes,
        'taux_survie':   taux
    })

@main.route('/api/stock_actuel')
def api_stock_actuel():
    """Tous les établissements actifs aujourd'hui"""
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    code_commune = request.args.get('code_commune', '')
    code_epci    = request.args.get('code_epci', '')
    section_naf  = request.args.get('section_naf', '')

    params = []
    cond   = ["e.geom IS NOT NULL", "e.etat_admin = 'A'"]

    if code_commune:
        cond.append("e.code_commune = %s"); params.append(code_commune)
    elif code_epci:
        cond.append("c.code_epci = %s"); params.append(code_epci)
    if section_naf:
        cond.append("e.section_naf = %s"); params.append(section_naf)

    where = " AND ".join(cond)

    cur.execute(f"""
        SELECT e.siret, e.nom, e.adresse,
               e.code_naf, e.libelle_naf, e.section_naf,
               e.tranche_effectif, e.etat_admin,
               e.date_creation, e.date_fermeture, e.est_siege,
               c.nom_commune, c.code_commune, c.code_epci, ep.nom_epci,
               ST_AsGeoJSON(e.geom)::json AS geometry,
               (SELECT ev2.type_evenement FROM evenements_etablissements ev2
                WHERE ev2.siret = e.siret
                ORDER BY ev2.date_evenement DESC LIMIT 1) as dernier_evenement
        FROM etablissements e
        JOIN communes c ON e.code_commune = c.code_commune
        JOIN epci ep ON c.code_epci = ep.code_epci
        WHERE {where}
    """, params)

    rows = cur.fetchall()

    # Stats
    cur.execute(f"""
        SELECT
            COUNT(*) as total,
            COUNT(DISTINCT e.section_naf) as nb_secteurs
        FROM etablissements e
        JOIN communes c ON e.code_commune = c.code_commune
        WHERE {where}
    """, params)
    stats = cur.fetchone()

    cur.close()
    conn.close()

    features = [{
        "type": "Feature",
        "properties": {
            "siret": r['siret'], "nom": r['nom'], "adresse": r['adresse'],
            "code_naf": r['code_naf'], "libelle_naf": r['libelle_naf'],
            "section_naf": r['section_naf'], "tranche_effectif": r['tranche_effectif'],
            "etat_admin": r['etat_admin'],
            "date_creation": str(r['date_creation']) if r['date_creation'] else None,
            "date_fermeture": None,
            "est_siege": r['est_siege'],
            "nom_commune": r['nom_commune'], "code_commune": r['code_commune'],
            "nom_epci": r['nom_epci'],
            "dernier_evenement": r['dernier_evenement']
        },
        "geometry": r['geometry']
    } for r in rows]

    return jsonify({
        "type": "FeatureCollection",
        "features": features,
        "total": stats['total'],
        "nb_affiches": len(features)
    })

@main.route('/api/stats_communes_stock')
def api_stats_communes_stock():
    """Nb actifs par commune pour choroplèthe stock"""
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    code_epci    = request.args.get('code_epci', '')
    code_commune = request.args.get('code_commune', '')
    section_naf  = request.args.get('section_naf', '')

    params = []
    cond   = ["e.etat_admin = 'A'"]

    if code_commune:
        cond.append("e.code_commune = %s"); params.append(code_commune)
    elif code_epci:
        cond.append("c.code_epci = %s"); params.append(code_epci)
    if section_naf:
        cond.append("e.section_naf = %s"); params.append(section_naf)

    cur.execute(f"""
        SELECT e.code_commune, c.nom_commune, COUNT(*) as nb_actifs
        FROM etablissements e
        JOIN communes c ON e.code_commune = c.code_commune
        WHERE {" AND ".join(cond)}
        GROUP BY e.code_commune, c.nom_commune
    """, params)

    rows = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify({r['code_commune']: dict(r) for r in rows})

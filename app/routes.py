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

def build_geo_conditions(params_list):
    """Construit les conditions géographiques communes aux deux routes"""
    conditions = []
    code_epci    = request.args.get('code_epci', '')
    code_commune = request.args.get('code_commune', '')

    if code_commune:
        conditions.append("e.code_commune = %s")
        params_list.append(code_commune)
    elif code_epci:
        conditions.append("c.code_epci = %s")
        params_list.append(code_epci)

    section_naf = request.args.get('section_naf', '')
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

    etat = request.args.get('etat', '')
    if etat:
        conditions.append("e.etat_admin = %s")
        params.append(etat)

    conditions += build_geo_conditions(params)

    annee_debut = request.args.get('annee_debut', '')
    annee_fin   = request.args.get('annee_fin', '')
    if annee_debut:
        conditions.append("e.date_creation >= %s")
        params.append(f"{annee_debut}-01-01")
    if annee_fin:
        conditions.append("e.date_creation <= %s")
        params.append(f"{annee_fin}-12-31")

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

    annee_debut = int(request.args.get('annee_debut', 2000))
    annee_fin   = int(request.args.get('annee_fin', 2025))

    # --- Évolution annuelle créations/cessations ---
    params_evo = [annee_debut, annee_fin]
    cond_evo = ["ev.annee BETWEEN %s AND %s"]

    code_commune = request.args.get('code_commune', '')
    code_epci    = request.args.get('code_epci', '')
    section_naf  = request.args.get('section_naf', '')

    if code_commune:
        cond_evo.append("e.code_commune = %s")
        params_evo.append(code_commune)
    elif code_epci:
        cond_evo.append("c.code_epci = %s")
        params_evo.append(code_epci)

    if section_naf:
        cond_evo.append("e.section_naf = %s")
        params_evo.append(section_naf)

    cur.execute(f"""
        SELECT ev.annee, ev.type_evenement, COUNT(*) as nb
        FROM evenements_etablissements ev
        JOIN etablissements e ON ev.siret = e.siret
        JOIN communes c ON e.code_commune = c.code_commune
        WHERE {" AND ".join(cond_evo)}
        GROUP BY ev.annee, ev.type_evenement
        ORDER BY ev.annee, ev.type_evenement
    """, params_evo)
    evolution = [dict(r) for r in cur.fetchall()]

    # --- Solde net sur la période (créations - cessations) ---
    total_creations  = sum(r['nb'] for r in evolution if r['type_evenement'] == 'creation')
    total_cessations = sum(r['nb'] for r in evolution if r['type_evenement'] == 'cessation')
    solde_periode    = total_creations - total_cessations

    # --- Répartition secteurs (actifs uniquement) ---
    params_sec = []
    cond_sec = ["e.etat_admin = 'A'"]

    if code_commune:
        cond_sec.append("e.code_commune = %s")
        params_sec.append(code_commune)
    elif code_epci:
        cond_sec.append("c.code_epci = %s")
        params_sec.append(code_epci)

    if section_naf:
        cond_sec.append("e.section_naf = %s")
        params_sec.append(section_naf)

    cur.execute(f"""
        SELECT e.section_naf, COUNT(*) as nb
        FROM etablissements e
        JOIN communes c ON e.code_commune = c.code_commune
        WHERE {" AND ".join(cond_sec)}
        GROUP BY e.section_naf
        ORDER BY nb DESC
    """, params_sec)
    secteurs = [dict(r) for r in cur.fetchall()]

    # --- Top communes (si filtre EPCI, pas commune) ---
    top_communes = []
    if not code_commune:
        params_top = [annee_debut, annee_fin]
        cond_top = ["ev.annee BETWEEN %s AND %s", "ev.type_evenement = 'creation'"]
        if code_epci:
            cond_top.append("c.code_epci = %s")
            params_top.append(code_epci)
        if section_naf:
            cond_top.append("e.section_naf = %s")
            params_top.append(section_naf)

        cur.execute(f"""
            SELECT c.nom_commune, COUNT(*) as nb_creations
            FROM evenements_etablissements ev
            JOIN etablissements e ON ev.siret = e.siret
            JOIN communes c ON e.code_commune = c.code_commune
            WHERE {" AND ".join(cond_top)}
            GROUP BY c.nom_commune
            ORDER BY nb_creations DESC
            LIMIT 8
        """, params_top)
        top_communes = [dict(r) for r in cur.fetchall()]

    cur.close()
    conn.close()

    return jsonify({
        "evolution":       evolution,
        "secteurs":        secteurs,
        "top_communes":    top_communes,
        "solde_periode":   solde_periode,
        "total_creations": total_creations,
        "total_cessations": total_cessations
    })

@main.route('/api/sections_naf')
def api_sections_naf():
    sections = {
        'A': 'Agriculture, sylviculture et pêche',
        'B': 'Industries extractives',
        'C': 'Industrie manufacturière',
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

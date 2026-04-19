from flask import Blueprint, render_template, jsonify
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
        SELECT
            code_epci,
            nom_epci,
            type_epci,
            ST_AsGeoJSON(geom)::json AS geometry
        FROM epci
        ORDER BY nom_epci
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
        SELECT
            c.code_commune,
            c.nom_commune,
            c.code_epci,
            e.nom_epci,
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

@main.route('/api/etablissements')
def api_etablissements():
    from flask import request
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Filtres
    etat = request.args.get('etat', '')
    section_naf = request.args.get('section_naf', '')
    code_epci = request.args.get('code_epci', '')
    annee_debut = request.args.get('annee_debut', '2000')
    annee_fin = request.args.get('annee_fin', '2025')

    conditions = ["e.geom IS NOT NULL"]
    params = []

    if etat:
        conditions.append("e.etat_admin = %s")
        params.append(etat)

    if section_naf:
        conditions.append("e.section_naf = %s")
        params.append(section_naf)

    if code_epci:
        conditions.append("c.code_epci = %s")
        params.append(code_epci)

    if annee_debut:
        conditions.append("(EXTRACT(YEAR FROM e.date_creation) >= %s OR e.date_creation IS NULL)")
        params.append(int(annee_debut))

    if annee_fin:
        conditions.append("(EXTRACT(YEAR FROM e.date_creation) <= %s OR e.date_creation IS NULL)")
        params.append(int(annee_fin))

    where = " AND ".join(conditions)

    cur.execute(f"""
        SELECT
            e.siret,
            e.nom,
            e.adresse,
            e.code_naf,
            e.libelle_naf,
            e.section_naf,
            e.tranche_effectif,
            e.etat_admin,
            e.date_creation,
            e.date_fermeture,
            e.est_siege,
            c.nom_commune,
            c.code_epci,
            ep.nom_epci,
            ST_AsGeoJSON(e.geom)::json AS geometry
        FROM etablissements e
        JOIN communes c ON e.code_commune = c.code_commune
        JOIN epci ep ON c.code_epci = ep.code_epci
        WHERE {where}
        LIMIT 5000
    """, params)

    rows = cur.fetchall()
    cur.close()
    conn.close()

    features = [{
        "type": "Feature",
        "properties": {
            "siret": r['siret'],
            "nom": r['nom'],
            "adresse": r['adresse'],
            "code_naf": r['code_naf'],
            "libelle_naf": r['libelle_naf'],
            "section_naf": r['section_naf'],
            "tranche_effectif": r['tranche_effectif'],
            "etat_admin": r['etat_admin'],
            "date_creation": str(r['date_creation']) if r['date_creation'] else None,
            "date_fermeture": str(r['date_fermeture']) if r['date_fermeture'] else None,
            "est_siege": r['est_siege'],
            "nom_commune": r['nom_commune'],
            "nom_epci": r['nom_epci']
        },
        "geometry": r['geometry']
    } for r in rows]

    return jsonify({
        "type": "FeatureCollection",
        "features": features,
        "total": len(features)
    })

@main.route('/api/sections_naf')
def api_sections_naf():
    sections = {
        'A': 'Agriculture, sylviculture et pêche',
        'B': 'Industries extractives',
        'C': 'Industrie manufacturière',
        'D': 'Production et distribution d\'énergie',
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
        'T': 'Ménages en tant qu\'employeurs',
        'U': 'Activités extra-territoriales'
    }
    from flask import jsonify
    return jsonify(sections)

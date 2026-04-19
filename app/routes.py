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

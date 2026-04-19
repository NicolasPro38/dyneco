import subprocess
import json
import psycopg2
import os
import time

from dotenv import load_dotenv
load_dotenv()

DB_URL = os.getenv('DATABASE_URL')
BASE_URL = "https://opendata.isere.fr/api/explore/v2.1/catalog/datasets/base-sirene-v3-ss/records"

def get_conn():
    return psycopg2.connect(DB_URL)

def get_codes_communes():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT code_commune FROM communes")
    codes = [r[0] for r in cur.fetchall()]
    cur.close()
    conn.close()
    return codes

def fetch_curl(code_commune, offset=0, limit=100):
    url = f"{BASE_URL}?where=codecommuneetablissement%3D%27{code_commune}%27&limit={limit}&offset={offset}"
    try:
        result = subprocess.run(
            ['curl', '-s', '--max-time', '30', url],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        if result.returncode == 0 and result.stdout:
            return json.loads(result.stdout.decode('utf-8'))
    except Exception as e:
        print(f"    curl error: {e}")
    return None

def parse_nom(row):
    return (
        row.get('denominationusuelleetablissement') or
        row.get('denominationunitelegale') or
        row.get('nomusuelunitelegale') or
        (f"{row.get('prenom1unitelegale','')} {row.get('nomunitelegale','')}".strip()) or
        'N/A'
    )

def parse_adresse(row):
    parts = [
        str(row.get('numerovoieetablissement') or ''),
        row.get('typevoieetablissement') or '',
        row.get('libellevoieetablissement') or '',
        row.get('codepostaletablissement') or '',
        row.get('libellecommuneetablissement') or '',
    ]
    return ' '.join(p for p in parts if p).strip()

def parse_etat(row):
    val = row.get('etatadministratifetablissement', '')
    return 'A' if val in ('A', 'Actif') else 'F'

def parse_date(val):
    if not val:
        return None
    return val[:10] if len(val) >= 10 else None

def parse_section(row):
    code_naf = row.get('activiteprincipaleetablissement') or ''
    if not code_naf:
        return None
    div = code_naf[:2]
    try:
        d = int(div)
    except:
        return None
    if d <= 3: return 'A'
    if d <= 9: return 'B'
    if d <= 33: return 'C'
    if d == 35: return 'D'
    if d <= 39: return 'E'
    if d <= 43: return 'F'
    if d <= 47: return 'G'
    if d <= 53: return 'H'
    if d <= 56: return 'I'
    if d <= 63: return 'J'
    if d <= 66: return 'K'
    if d == 68: return 'L'
    if d <= 75: return 'M'
    if d <= 82: return 'N'
    if d == 84: return 'O'
    if d == 85: return 'P'
    if d <= 88: return 'Q'
    if d <= 93: return 'R'
    if d <= 96: return 'S'
    if d == 97: return 'T'
    return 'U'

def insert_etablissement(cur, row, code_commune):
    code_naf = row.get('activiteprincipaleetablissement') or row.get('activiteprincipaleunitelegale') or ''
    division_naf = code_naf[:2] if len(code_naf) >= 2 else None
    section_naf = parse_section(row)

    geo = row.get('geolocetablissement')
    geom = None
    if geo and isinstance(geo, dict) and 'lat' in geo and 'lon' in geo:
        geom = f"SRID=4326;POINT({geo['lon']} {geo['lat']})"

    cur.execute("""
        INSERT INTO etablissements (
            siret, siren, nom, adresse, code_commune,
            code_naf, libelle_naf, section_naf, division_naf,
            categorie_juridique, libelle_cat_juri,
            tranche_effectif, est_siege, etat_admin,
            date_creation, date_fermeture, geom
        ) VALUES (
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s,
            %s, %s, %s,
            %s, %s, %s
        )
        ON CONFLICT (siret) DO UPDATE SET
            etat_admin = EXCLUDED.etat_admin,
            date_fermeture = EXCLUDED.date_fermeture,
            tranche_effectif = EXCLUDED.tranche_effectif,
            section_naf = EXCLUDED.section_naf,
            geom = EXCLUDED.geom
    """, (
        row.get('siret'), row.get('siren'),
        parse_nom(row), parse_adresse(row), code_commune,
        code_naf,
        row.get('libelleactiviteprincipaleetablissement') or row.get('classeetablissement'),
        section_naf, division_naf,
        row.get('categoriejuridiqueunitelegale'),
        row.get('naturejuridiqueunitelegale'),
        row.get('trancheeffectifsetablissement'),
        row.get('etablissementsiege') in ('oui', True),
        parse_etat(row),
        parse_date(row.get('datecreationetablissement')),
        parse_date(row.get('datefermetureetablissement')),
        geom
    ))

def insert_evenements(cur, row):
    siret = row.get('siret')
    if not siret:
        return
    for champ, type_evt in [
        ('datecreationetablissement', 'creation'),
        ('datefermetureetablissement', 'cessation'),
    ]:
        date_val = parse_date(row.get(champ))
        if date_val and len(date_val) == 10:
            try:
                annee = int(date_val[:4])
                mois = int(date_val[5:7])
                if 1973 <= annee <= 2030:
                    trimestre = (mois - 1) // 3 + 1
                    cur.execute("""
                        INSERT INTO evenements_etablissements
                            (siret, type_evenement, date_evenement, annee, trimestre, source)
                        VALUES (%s, %s, %s, %s, %s, 'SIRENE')
                        ON CONFLICT DO NOTHING
                    """, (siret, type_evt, date_val, annee, trimestre))
            except:
                pass

# --- MAIN ---
codes_communes = get_codes_communes()
print(f"Import Sirene pour {len(codes_communes)} communes...")

conn = get_conn()
cur = conn.cursor()
total_insere = 0
erreurs = 0

for i, code in enumerate(codes_communes):
    offset = 0
    commune_total = 0
    retries = 0

    while True:
        data = fetch_curl(code, offset=offset, limit=100)

        if not data or 'results' not in data:
            retries += 1
            if retries >= 3:
                erreurs += 1
                print(f"    Abandon {code}")
                break
            time.sleep(2)
            continue

        retries = 0
        results = data['results']
        if not results:
            break

        for row in results:
            try:
                insert_etablissement(cur, row, code)
                insert_evenements(cur, row)
                commune_total += 1
            except Exception as e:
                conn.rollback()
                continue

        conn.commit()
        offset += len(results)

        if len(results) < 100:
            break

        time.sleep(0.1)

    total_insere += commune_total
    print(f"  [{i+1}/{len(codes_communes)}] {code} : {commune_total} étab. (total: {total_insere})")

cur.close()
conn.close()
print(f"\nImport terminé : {total_insere} établissements | {erreurs} communes en erreur")

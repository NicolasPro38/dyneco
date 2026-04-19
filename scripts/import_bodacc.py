import subprocess
import json
import psycopg2
import os
import time
from dotenv import load_dotenv
load_dotenv()

DB_URL = os.getenv('DATABASE_URL')
BASE_URL = "https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records"

def get_conn():
    return psycopg2.connect(DB_URL)

def get_sirens_zone():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT DISTINCT siren FROM etablissements WHERE siren IS NOT NULL")
    sirens = set(r[0] for r in cur.fetchall())
    cur.close()
    conn.close()
    return sirens

def fetch_bodacc_annee(annee, offset=0, limit=100, retries=3):
    url = (f"{BASE_URL}?where=numerodepartement%3D%2738%27"
           f"%20AND%20familleavis%3D%27collective%27"
           f"%20AND%20year(dateparution)%3D{annee}"
           f"&limit={limit}&offset={offset}"
           f"&select=dateparution,commercant,registre,jugement")
    for attempt in range(retries):
        result = subprocess.run(
            ['curl', '-s', '--max-time', '30', url],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
        if result.returncode == 0 and result.stdout:
            try:
                data = json.loads(result.stdout.decode('utf-8'))
                if 'results' in data:
                    return data
            except:
                pass
        time.sleep((attempt + 1) * 3)
    return None

def parse_type_evenement(jugement_str):
    if not jugement_str:
        return None
    try:
        j = json.loads(jugement_str) if isinstance(jugement_str, str) else jugement_str
        nature = j.get('nature', '').lower()
        if 'liquidation' in nature:
            return 'liquidation'
        return 'redressement'
    except:
        return None

def parse_siren(registre):
    if not registre:
        return None
    items = registre if isinstance(registre, list) else [registre]
    for r in items:
        clean = r.replace(' ', '').strip()
        if len(clean) == 9 and clean.isdigit():
            return clean
    return None

def parse_date(date_str):
    if not date_str or len(date_str) < 10:
        return None
    return date_str[:10]

# --- MAIN ---
print("Chargement des SIREN de la zone...")
sirens_zone = get_sirens_zone()
print(f"{len(sirens_zone):,} SIREN dans la zone")

conn = get_conn()
cur = conn.cursor()
total_insere = 0
total_ignore = 0

# Traiter année par année de 2000 à 2026
for annee in range(2000, 2027):
    # Vérifier combien on a déjà pour cette année
    cur.execute("""
        SELECT COUNT(*) FROM evenements_etablissements
        WHERE source = 'BODACC' AND annee = %s
    """, (annee,))
    deja = cur.fetchone()[0]

    # Compter le total pour cette année
    data = fetch_bodacc_annee(annee, offset=0, limit=1)
    if not data:
        print(f"  {annee} : erreur API")
        continue
    total_annee = data.get('total_count', 0)

    if deja >= total_annee:
        print(f"  {annee} : déjà complet ({deja} événements)")
        continue

    print(f"  {annee} : {total_annee} annonces à traiter ({deja} déjà en base)...")

    offset = 0
    annee_insere = 0

    while offset < total_annee:
        data = fetch_bodacc_annee(annee, offset=offset, limit=100)
        if not data or 'results' not in data:
            print(f"    Erreur offset {offset}, on saute...")
            offset += 100
            time.sleep(5)
            continue

        results = data.get('results', [])
        if not results:
            break

        for row in results:
            siren = parse_siren(row.get('registre'))
            if not siren or siren not in sirens_zone:
                total_ignore += 1
                continue

            type_evt = parse_type_evenement(row.get('jugement'))
            date_str  = parse_date(row.get('dateparution'))
            if not type_evt or not date_str:
                total_ignore += 1
                continue

            try:
                mois = int(date_str[5:7])
                trimestre = (mois - 1) // 3 + 1

                cur.execute("""
                    SELECT siret FROM etablissements
                    WHERE siren = %s AND est_siege = TRUE LIMIT 1
                """, (siren,))
                row_etab = cur.fetchone()
                if not row_etab:
                    cur.execute("SELECT siret FROM etablissements WHERE siren = %s LIMIT 1", (siren,))
                    row_etab = cur.fetchone()
                if not row_etab:
                    total_ignore += 1
                    continue

                cur.execute("""
                    INSERT INTO evenements_etablissements
                        (siret, type_evenement, date_evenement, annee, trimestre, source, detail)
                    VALUES (%s, %s, %s, %s, %s, 'BODACC', %s)
                    ON CONFLICT DO NOTHING
                """, (
                    row_etab[0], type_evt, date_str, annee, trimestre,
                    json.dumps({'commercant': row.get('commercant'), 'siren': siren})
                ))
                annee_insere += 1
                total_insere += 1

            except Exception as e:
                conn.rollback()
                continue

        conn.commit()
        offset += len(results)
        time.sleep(0.2)

    print(f"    → {annee_insere} insérés")

cur.close()
conn.close()
print(f"\nTerminé : {total_insere:,} insérés | {total_ignore:,} ignorés")

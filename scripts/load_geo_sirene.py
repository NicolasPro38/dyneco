import csv
import psycopg2
import os
import json

from dotenv import load_dotenv
load_dotenv()

DB_URL = os.getenv('DATABASE_URL')
INPUT = "data/raw/geo_siret_38.csv"

# Charger les codes communes cibles
conn = psycopg2.connect(DB_URL)
cur = conn.cursor()
cur.execute("SELECT code_commune FROM communes")
codes_communes = set(r[0] for r in cur.fetchall())
print(f"Communes cibles : {len(codes_communes)}")

# Correspondance section NAF
def parse_section(code_naf):
    if not code_naf or len(code_naf) < 2:
        return None
    try:
        d = int(code_naf[:2])
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

def parse_date(val):
    if not val or len(val) < 10:
        return None
    return val[:10]

def parse_geom(row):
    lon = row.get('longitude', '').strip()
    lat = row.get('latitude', '').strip()
    if lon and lat:
        try:
            return f"SRID=4326;POINT({float(lon)} {float(lat)})"
        except:
            pass
    return None

def parse_nom(row):
    return (
        row.get('denominationUsuelleEtablissement', '').strip() or
        'N/A'
    )

def parse_adresse(row):
    parts = [
        row.get('numeroVoieEtablissement', '').strip(),
        row.get('typeVoieEtablissement', '').strip(),
        row.get('libelleVoieEtablissement', '').strip(),
        row.get('codePostalEtablissement', '').strip(),
        row.get('libelleCommuneEtablissement', '').strip(),
    ]
    return ' '.join(p for p in parts if p).strip()

print("Lecture du CSV et import en base...")
total = 0
inseres = 0
erreurs = 0

with open(INPUT, encoding='utf-8', errors='replace') as f:
    reader = csv.DictReader(f)
    batch = []

    for row in reader:
        total += 1
        if total % 100000 == 0:
            print(f"  {total:,} lignes lues, {inseres:,} insérées...")

        code_commune = row.get('codeCommuneEtablissement', '').strip()
        if code_commune not in codes_communes:
            continue

        siret = row.get('siret', '').strip()
        if not siret:
            continue

        code_naf = row.get('activitePrincipaleEtablissement', '').strip()
        etat = row.get('etatAdministratifEtablissement', '').strip()
        etat_admin = 'A' if etat == 'A' else 'F'
        date_creation = parse_date(row.get('dateCreationEtablissement', ''))
        date_fermeture = parse_date(row.get('dateDebut', '') if etat == 'F' else '')

        try:
            cur.execute("""
                INSERT INTO etablissements (
                    siret, siren, nom, adresse, code_commune,
                    code_naf, section_naf, division_naf,
                    tranche_effectif, est_siege, etat_admin,
                    date_creation, date_fermeture, geom
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (siret) DO UPDATE SET
                    etat_admin = EXCLUDED.etat_admin,
                    date_fermeture = EXCLUDED.date_fermeture,
                    tranche_effectif = EXCLUDED.tranche_effectif,
                    section_naf = EXCLUDED.section_naf,
                    geom = COALESCE(EXCLUDED.geom, etablissements.geom)
            """, (
                siret,
                row.get('siren', '').strip(),
                parse_nom(row),
                parse_adresse(row),
                code_commune,
                code_naf,
                parse_section(code_naf),
                code_naf[:2] if len(code_naf) >= 2 else None,
                row.get('trancheEffectifsEtablissement', '').strip() or None,
                row.get('etablissementSiege', '').strip() == 'true',
                etat_admin,
                date_creation,
                date_fermeture,
                parse_geom(row)
            ))

            # Événements
            if date_creation:
                try:
                    annee = int(date_creation[:4])
                    mois = int(date_creation[5:7])
                    if 1973 <= annee <= 2030:
                        cur.execute("""
                            INSERT INTO evenements_etablissements
                                (siret, type_evenement, date_evenement, annee, trimestre, source)
                            VALUES (%s,'creation',%s,%s,%s,'SIRENE')
                            ON CONFLICT DO NOTHING
                        """, (siret, date_creation, annee, (mois-1)//3+1))
                except:
                    pass

            inseres += 1

            if inseres % 1000 == 0:
                conn.commit()

        except Exception as e:
            conn.rollback()
            erreurs += 1
            continue

conn.commit()
cur.close()
conn.close()

print(f"\nTerminé : {total:,} lignes lues")
print(f"  {inseres:,} établissements insérés/mis à jour")
print(f"  {erreurs:,} erreurs")

# Stats finales
conn = psycopg2.connect(DB_URL)
cur = conn.cursor()
cur.execute("SELECT COUNT(*) FROM etablissements")
print(f"\nTotal en base : {cur.fetchone()[0]:,}")
cur.execute("SELECT COUNT(*) FROM etablissements WHERE etat_admin='A'")
print(f"Actifs : {cur.fetchone()[0]:,}")
cur.execute("SELECT COUNT(*) FROM etablissements WHERE geom IS NOT NULL")
print(f"Géolocalisés : {cur.fetchone()[0]:,}")
cur.close()
conn.close()

import json
import psycopg2
import os
import glob

from dotenv import load_dotenv
load_dotenv()

DB_URL = os.getenv('DATABASE_URL')
SIRENE_DIR = "data/processed/sirene"

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
    if not val or len(val) < 10:
        return None
    return val[:10]

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

def parse_geom(row):
    geo = row.get('geolocetablissement')
    if geo and isinstance(geo, dict):
        lon = geo.get('lon')
        lat = geo.get('lat')
        if lon is not None and lat is not None:
            return f"SRID=4326;POINT({lon} {lat})"
    return None

# --- MAIN ---
fichiers = sorted(glob.glob(f"{SIRENE_DIR}/*.json"))
print(f"Chargement de {len(fichiers)} fichiers JSON...")

conn = psycopg2.connect(DB_URL)
cur = conn.cursor()
total = 0
erreurs = 0
premiers_erreurs = []

for fi, fpath in enumerate(fichiers):
    fname = os.path.basename(fpath)
    code_commune = fname.split('_')[0]

    try:
        with open(fpath, encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"  Erreur lecture {fname}: {e}")
        continue

    results = data.get('results', [])
    fichier_ok = 0

    for row in results:
        code_naf = row.get('activiteprincipaleetablissement') or row.get('activiteprincipaleunitelegale') or ''
        try:
            cur.execute("""
                INSERT INTO etablissements (
                    siret, siren, nom, adresse, code_commune,
                    code_naf, libelle_naf, section_naf, division_naf,
                    categorie_juridique, libelle_cat_juri,
                    tranche_effectif, est_siege, etat_admin,
                    date_creation, date_fermeture, geom
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
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
                parse_section(code_naf),
                code_naf[:2] if len(code_naf) >= 2 else None,
                row.get('categoriejuridiqueunitelegale'),
                row.get('naturejuridiqueunitelegale'),
                row.get('trancheeffectifsetablissement'),
                row.get('etablissementsiege') in ('oui', True),
                parse_etat(row),
                parse_date(row.get('datecreationetablissement')),
                parse_date(row.get('datefermetureetablissement')),
                parse_geom(row)
            ))

            siret = row.get('siret')
            for champ, type_evt in [
                ('datecreationetablissement', 'creation'),
                ('datefermetureetablissement', 'cessation'),
            ]:
                date_val = parse_date(row.get(champ))
                if date_val:
                    annee = int(date_val[:4])
                    mois = int(date_val[5:7])
                    if 1973 <= annee <= 2030:
                        cur.execute("""
                            INSERT INTO evenements_etablissements
                                (siret, type_evenement, date_evenement, annee, trimestre, source)
                            VALUES (%s,%s,%s,%s,%s,'SIRENE')
                            ON CONFLICT DO NOTHING
                        """, (siret, type_evt, date_val, annee, (mois-1)//3+1))

            fichier_ok += 1
            total += 1

        except Exception as e:
            conn.rollback()
            erreurs += 1
            if len(premiers_erreurs) < 5:
                premiers_erreurs.append(f"{row.get('siret')}: {e}")
            continue

    conn.commit()
    print(f"  [{fi+1}/{len(fichiers)}] {fname} : {fichier_ok} étab. (total: {total})")

cur.close()
conn.close()

print(f"\nImport terminé : {total} établissements | {erreurs} erreurs")
if premiers_erreurs:
    print("Premières erreurs :")
    for e in premiers_erreurs:
        print(f"  {e}")

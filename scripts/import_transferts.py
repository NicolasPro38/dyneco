import csv
import psycopg2
import os
import zipfile
from dotenv import load_dotenv
load_dotenv()

DB_URL = os.getenv('DATABASE_URL')
ZIP_FILE = "data/raw/liens_succession.zip"

def get_conn():
    return psycopg2.connect(DB_URL)

# Charger les SIRET de notre zone
print("Chargement des SIRET de la zone...")
conn = get_conn()
cur = conn.cursor()
cur.execute("SELECT siret FROM etablissements")
sirets_zone = set(r[0] for r in cur.fetchall())
print(f"{len(sirets_zone):,} SIRET dans la zone")

# Lire le ZIP en streaming
print("Lecture du fichier liens de succession...")
total = 0
inseres = 0
erreurs = 0

with zipfile.ZipFile(ZIP_FILE) as z:
    csv_name = [n for n in z.namelist() if n.endswith('.csv')][0]
    with z.open(csv_name) as f:
        reader = csv.DictReader(
            (line.decode('utf-8') for line in f),
            delimiter=','
        )
        for row in reader:
            total += 1
            if total % 500000 == 0:
                print(f"  {total:,} lignes lues, {inseres:,} insérés...")

            siret_pred = row.get('siretEtablissementPredecesseur', '').strip()
            siret_succ = row.get('siretEtablissementSuccesseur', '').strip()

            # On garde si au moins un des deux est dans notre zone
            if siret_pred not in sirets_zone and siret_succ not in sirets_zone:
                continue

            date_str = row.get('dateLienSuccession', '').strip()
            if not date_str or len(date_str) < 10:
                continue

            try:
                annee = int(date_str[:4])
                mois  = int(date_str[5:7])
                if annee < 2000 or annee > 2030:
                    continue
                trimestre = (mois - 1) // 3 + 1

                transfert_siege = row.get('transfertSiege', '').strip().lower() == 'true'
                continuite      = row.get('continuiteEconomique', '').strip().lower() == 'true'

                # Insérer pour le prédécesseur (transfert sortant)
                if siret_pred in sirets_zone:
                    cur.execute("""
                        INSERT INTO evenements_etablissements
                            (siret, type_evenement, date_evenement, annee, trimestre, source, detail)
                        VALUES (%s, 'transfert', %s, %s, %s, 'SIRENE', %s)
                        ON CONFLICT DO NOTHING
                    """, (
                        siret_pred, date_str, annee, trimestre,
                        f'{{"type":"sortant","successeur":"{siret_succ}","transfert_siege":{str(transfert_siege).lower()},"continuite":{str(continuite).lower()}}}'
                    ))
                    inseres += 1

                # Insérer pour le successeur (transfert entrant)
                if siret_succ in sirets_zone:
                    cur.execute("""
                        INSERT INTO evenements_etablissements
                            (siret, type_evenement, date_evenement, annee, trimestre, source, detail)
                        VALUES (%s, 'transfert', %s, %s, %s, 'SIRENE', %s)
                        ON CONFLICT DO NOTHING
                    """, (
                        siret_succ, date_str, annee, trimestre,
                        f'{{"type":"entrant","predecesseur":"{siret_pred}","transfert_siege":{str(transfert_siege).lower()},"continuite":{str(continuite).lower()}}}'
                    ))
                    inseres += 1

                if inseres % 10000 == 0:
                    conn.commit()

            except Exception as e:
                erreurs += 1
                conn.rollback()
                continue

conn.commit()
cur.close()
conn.close()

print(f"\nTerminé : {total:,} lignes lues")
print(f"  {inseres:,} transferts insérés")
print(f"  {erreurs:,} erreurs")

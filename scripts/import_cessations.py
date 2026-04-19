import psycopg2
import os
from dotenv import load_dotenv
load_dotenv()

conn = psycopg2.connect(os.getenv('DATABASE_URL'))
cur = conn.cursor()

print("Import des cessations depuis les établissements fermés...")

# Récupérer tous les établissements fermés avec date de fermeture
# qui n'ont pas encore d'événement de cessation
cur.execute("""
    SELECT e.siret, e.date_fermeture
    FROM etablissements e
    WHERE e.etat_admin = 'F'
    AND e.date_fermeture IS NOT NULL
    AND e.date_fermeture >= '2000-01-01'
    AND NOT EXISTS (
        SELECT 1 FROM evenements_etablissements ev
        WHERE ev.siret = e.siret
        AND ev.type_evenement = 'cessation'
    )
""")

rows = cur.fetchall()
print(f"{len(rows)} cessations à importer...")

inseres = 0
erreurs = 0

for siret, date_fermeture in rows:
    try:
        annee = date_fermeture.year
        mois  = date_fermeture.month
        trimestre = (mois - 1) // 3 + 1

        cur.execute("""
            INSERT INTO evenements_etablissements
                (siret, type_evenement, date_evenement, annee, trimestre, source)
            VALUES (%s, 'cessation', %s, %s, %s, 'SIRENE')
            ON CONFLICT DO NOTHING
        """, (siret, date_fermeture, annee, trimestre))
        inseres += 1

        if inseres % 10000 == 0:
            conn.commit()
            print(f"  {inseres:,} insérés...")

    except Exception as e:
        erreurs += 1
        conn.rollback()
        continue

conn.commit()
cur.close()
conn.close()

print(f"\nTerminé : {inseres:,} cessations importées | {erreurs} erreurs")

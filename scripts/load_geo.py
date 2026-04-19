import geopandas as gpd
import psycopg2
from shapely.geometry import mapping
import json
import os
import warnings
warnings.filterwarnings('ignore')

from dotenv import load_dotenv
load_dotenv()

DB_URL = os.getenv('DATABASE_URL')

def get_conn():
    return psycopg2.connect(DB_URL)

def load_epcis():
    gdf = gpd.read_file("data/raw/epcis.geojson")
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("TRUNCATE TABLE epci CASCADE")
    for _, row in gdf.iterrows():
        cur.execute("""
            INSERT INTO epci (code_epci, nom_epci, type_epci, geom)
            VALUES (%s, %s, %s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
        """, (
            row['code_epci'],
            row['nom_epci'],
            row['type_epci'],
            json.dumps(mapping(row.geometry))
        ))
    conn.commit()
    cur.close()
    conn.close()
    print(f"EPCI chargés : {len(gdf)}")

def load_communes():
    gdf = gpd.read_file("data/raw/communes_epci.geojson")
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("TRUNCATE TABLE communes CASCADE")
    for _, row in gdf.iterrows():
        cur.execute("""
            INSERT INTO communes (code_commune, nom_commune, code_epci, geom)
            VALUES (%s, %s, %s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
        """, (
            row['code'],
            row['nom'],
            row['code_epci'],
            json.dumps(mapping(row.geometry))
        ))
    conn.commit()
    cur.close()
    conn.close()
    print(f"Communes chargées : {len(gdf)}")

print("Chargement des données géographiques...")
load_epcis()
load_communes()
print("Terminé.")

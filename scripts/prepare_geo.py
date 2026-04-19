import requests
import json
import geopandas as gpd
from shapely.ops import unary_union
import os
import warnings
warnings.filterwarnings('ignore')

OUTPUT_DIR = "data/raw"

EPCIS = [
    {"code": "200040715", "nom": "Grenoble-Alpes Métropole", "type": "Metro"},
    {"code": "243800984", "nom": "CA du Pays Voironnais", "type": "CA"},
    {"code": "200018166", "nom": "CC du Pays du Grésivaudan", "type": "CC"},
]

def get_communes_epci(code_epci):
    url = f"https://geo.api.gouv.fr/epcis/{code_epci}/communes?fields=nom,code,contour&format=geojson&geometry=contour"
    r = requests.get(url)
    print(f"    status: {r.status_code} / taille: {len(r.content)} bytes")
    return r.json()

print("Récupération des communes par EPCI...")
all_epci_features = []
all_communes_features = []

for epci in EPCIS:
    print(f"  → {epci['nom']} ({epci['code']})")
    geojson = get_communes_epci(epci['code'])

    if 'features' not in geojson or len(geojson['features']) == 0:
        print(f"    ERREUR : aucune commune retournée")
        continue

    print(f"    {len(geojson['features'])} communes récupérées")

    for f in geojson['features']:
        f['properties']['code_epci'] = epci['code']
        f['properties']['nom_epci'] = epci['nom']
        all_communes_features.append(f)

    gdf = gpd.GeoDataFrame.from_features(geojson['features'], crs="EPSG:4326")
    contour = unary_union(gdf.geometry)

    all_epci_features.append({
        "type": "Feature",
        "properties": {
            "code_epci": epci['code'],
            "nom_epci": epci['nom'],
            "type_epci": epci['type']
        },
        "geometry": json.loads(gpd.GeoSeries([contour], crs="EPSG:4326").to_json())['features'][0]['geometry']
    })

communes_geojson = {"type": "FeatureCollection", "features": all_communes_features}
with open(f"{OUTPUT_DIR}/communes_epci.geojson", "w") as f:
    json.dump(communes_geojson, f)
print(f"\nCommunes sauvegardées : {len(all_communes_features)} communes")

epci_geojson = {"type": "FeatureCollection", "features": all_epci_features}
with open(f"{OUTPUT_DIR}/epcis.geojson", "w") as f:
    json.dump(epci_geojson, f)
print(f"EPCI sauvegardés : {len(all_epci_features)} EPCI")

print("\nFichiers générés :")
for fname in ["communes_epci.geojson", "epcis.geojson"]:
    path = f"{OUTPUT_DIR}/{fname}"
    size = os.path.getsize(path)
    print(f"  {fname} : {size/1024:.1f} Ko")

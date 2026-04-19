import subprocess
import json
import os
import time

OUTPUT_DIR = "data/processed/sirene"
BASE_URL = "https://opendata.isere.fr/api/explore/v2.1/catalog/datasets/base-sirene-v3-ss/records"

import psycopg2
from dotenv import load_dotenv
load_dotenv()

conn = psycopg2.connect(os.getenv('DATABASE_URL'))
cur = conn.cursor()
cur.execute("SELECT code_commune FROM communes ORDER BY code_commune")
communes = [r[0] for r in cur.fetchall()]
cur.close()
conn.close()

print(f"Fetch de {len(communes)} communes...")

def fetch_page(code, offset, retries=3):
    url = f"{BASE_URL}?where=codecommuneetablissement%3D%27{code}%27&limit=100&offset={offset}"
    for attempt in range(retries):
        result = subprocess.run(
            ['curl', '-s', '--max-time', '60', url],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
        if result.returncode == 0 and result.stdout:
            try:
                data = json.loads(result.stdout.decode('utf-8'))
                if 'results' in data:
                    return data
            except:
                pass
        print(f"    tentative {attempt+1}/{retries} échouée, attente...")
        time.sleep(3)
    return None

for i, code in enumerate(communes):
    page = 0
    offset = 0
    commune_total = 0

    while True:
        outfile = f"{OUTPUT_DIR}/{code}_{page}.json"

        # Skip si déjà fetché et complet
        if os.path.exists(outfile):
            try:
                with open(outfile) as f:
                    existing = json.load(f)
                if len(existing.get('results', [])) > 0:
                    commune_total += len(existing['results'])
                    offset += len(existing['results'])
                    page += 1
                    if len(existing['results']) < 100:
                        break
                    continue
            except:
                pass

        data = fetch_page(code, offset)
        if not data:
            print(f"  [{i+1}] {code} p{page} : abandon après {retries} tentatives")
            break

        results = data.get('results', [])
        if not results:
            break

        with open(outfile, 'w') as f:
            json.dump(data, f)

        commune_total += len(results)
        offset += len(results)
        page += 1

        if len(results) < 100:
            break

        time.sleep(0.5)  # plus prudent

    print(f"  [{i+1}/{len(communes)}] {code} : {commune_total} étab. ({page} pages)")

print("Fetch terminé.")

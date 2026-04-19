#!/bin/bash
BASE_URL="https://opendata.isere.fr/api/explore/v2.1/catalog/datasets/base-sirene-v3-ss/records"
OUTPUT_DIR="data/processed/sirene"
mkdir -p "$OUTPUT_DIR"

COMMUNES=($(psql -U nicolasrey -d dyneco -t -c "SELECT code_commune FROM communes ORDER BY code_commune"))

total=${#COMMUNES[@]}
echo "Fetching $total communes..."

for i in "${!COMMUNES[@]}"; do
    code="${COMMUNES[$i]}"
    code=$(echo $code | tr -d ' ')
    offset=0
    page=0

    while true; do
        outfile="$OUTPUT_DIR/${code}_${page}.json"
        url="${BASE_URL}?where=codecommuneetablissement%3D%27${code}%27&limit=100&offset=${offset}"
        
        curl -s --max-time 30 "$url" -o "$outfile"
        
        count=$(python3 -c "import json; d=json.load(open('$outfile')); print(len(d.get('results',[])))" 2>/dev/null)
        
        if [ -z "$count" ] || [ "$count" -eq 0 ]; then
            rm -f "$outfile"
            break
        fi
        
        echo "  [$((i+1))/$total] $code page $page : $count résultats"
        offset=$((offset + count))
        page=$((page + 1))
        
        if [ "$count" -lt 100 ]; then
            break
        fi
        
        sleep 0.1
    done
done

echo "Fetch terminé."

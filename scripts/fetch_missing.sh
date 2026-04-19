#!/bin/bash
BASE_URL="https://opendata.isere.fr/api/explore/v2.1/catalog/datasets/base-sirene-v3-ss/records"
OUTPUT_DIR="data/processed/sirene"
mkdir -p "$OUTPUT_DIR"

COMMUNES=(38039 38043 38045 38061 38068 38075 38082 38100 38111 38133 38140 38150 38158 38169 38170 38175 38179 38187 38200 38229 38235 38239 38249 38258 38270 38279 38303 38309 38314 38317 38325 38328 38331 38334 38350 38364 38368 38382 38383 38386 38388 38400 38407 38418 38422 38423 38426 38471 38472 38478 38485 38486 38501 38511 38516 38517 38529 38533 38545 38562 38565 38567)

total=${#COMMUNES[@]}
echo "Fetching $total communes manquantes..."

for i in "${!COMMUNES[@]}"; do
    code="${COMMUNES[$i]}"
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

echo "Fetch communes manquantes terminé."

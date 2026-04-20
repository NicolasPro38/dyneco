#!/bin/bash
# Mise à jour mensuelle DynEco
LOG="/var/log/dyneco-update.log"
echo "=== Mise à jour DynEco $(date) ===" >> $LOG

cd /var/www/dyneco
source venv/bin/activate

# 1. Mise à jour du code
git pull >> $LOG 2>&1

# 2. Télécharger nouveau fichier Sirene 38
echo "Téléchargement Sirene 38..." >> $LOG
curl -L "https://files.data.gouv.fr/geo-sirene/last/dep/geo_siret_38.csv.gz" \
    -o data/raw/geo_siret_38.csv.gz >> $LOG 2>&1
gunzip -f data/raw/geo_siret_38.csv.gz >> $LOG 2>&1

# 3. Importer les nouveaux établissements
echo "Import Sirene..." >> $LOG
python scripts/load_geo_sirene.py >> $LOG 2>&1

# 4. Importer les nouvelles cessations
echo "Import cessations..." >> $LOG
python scripts/import_cessations.py >> $LOG 2>&1

# 5. Mettre à jour Bodacc
echo "Import Bodacc..." >> $LOG
python scripts/import_bodacc.py >> $LOG 2>&1

# 6. Redémarrer le service
echo "Redémarrage service..." >> $LOG
sudo systemctl restart dyneco >> $LOG 2>&1

echo "=== Terminé $(date) ===" >> $LOG

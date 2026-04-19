-- Extension PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- EPCI
CREATE TABLE epci (
    code_epci       VARCHAR(9) PRIMARY KEY,
    nom_epci        TEXT NOT NULL,
    type_epci       VARCHAR(10),
    geom            GEOMETRY(MultiPolygon, 4326)
);

-- Communes
CREATE TABLE communes (
    code_commune    VARCHAR(5) PRIMARY KEY,
    nom_commune     TEXT NOT NULL,
    code_epci       VARCHAR(9) REFERENCES epci(code_epci),
    geom            GEOMETRY(MultiPolygon, 4326)
);

-- Etablissements
CREATE TABLE etablissements (
    siret               VARCHAR(14) PRIMARY KEY,
    siren               VARCHAR(9) NOT NULL,
    nom                 TEXT,
    adresse             TEXT,
    code_commune        VARCHAR(5) REFERENCES communes(code_commune),
    code_naf            VARCHAR(6),
    libelle_naf         TEXT,
    section_naf         CHAR(1),
    division_naf        VARCHAR(2),
    categorie_juridique VARCHAR(4),
    libelle_cat_juri    TEXT,
    tranche_effectif    VARCHAR(2),
    est_siege           BOOLEAN DEFAULT FALSE,
    etat_admin          CHAR(1) CHECK (etat_admin IN ('A','F')),
    date_creation       DATE,
    date_fermeture      DATE,
    geom                GEOMETRY(Point, 4326)
);

-- Historique des variables Sirene
CREATE TABLE historique_etablissements (
    id              SERIAL PRIMARY KEY,
    siret           VARCHAR(14) REFERENCES etablissements(siret),
    variable        VARCHAR(50) NOT NULL,
    valeur_ancienne TEXT,
    valeur_nouvelle TEXT,
    date_debut      DATE NOT NULL,
    date_fin        DATE,
    source          VARCHAR(10) DEFAULT 'SIRENE'
);

-- Evénements datés
CREATE TABLE evenements_etablissements (
    id              SERIAL PRIMARY KEY,
    siret           VARCHAR(14) REFERENCES etablissements(siret),
    type_evenement  VARCHAR(40) NOT NULL,
    date_evenement  DATE NOT NULL,
    annee           SMALLINT NOT NULL,
    trimestre       SMALLINT CHECK (trimestre IN (1,2,3,4)),
    source          VARCHAR(10) DEFAULT 'SIRENE',
    detail          JSONB
);

-- Agrégats communes (table clé pour graphiques et choroplèthes)
CREATE TABLE stats_communes (
    id                      SERIAL PRIMARY KEY,
    code_commune            VARCHAR(5) REFERENCES communes(code_commune),
    annee                   SMALLINT NOT NULL,
    trimestre               SMALLINT CHECK (trimestre IN (1,2,3,4)),
    section_naf             CHAR(1),
    nb_actifs               INTEGER DEFAULT 0,
    nb_creations            INTEGER DEFAULT 0,
    nb_cessations           INTEGER DEFAULT 0,
    nb_transferts_entrants  INTEGER DEFAULT 0,
    nb_transferts_sortants  INTEGER DEFAULT 0,
    nb_redressements        INTEGER DEFAULT 0,
    nb_liquidations         INTEGER DEFAULT 0,
    solde_net               INTEGER DEFAULT 0,
    effectif_estime_min     INTEGER,
    effectif_estime_max     INTEGER,
    UNIQUE (code_commune, annee, trimestre, section_naf)
);

-- Index spatiaux
CREATE INDEX idx_etab_geom ON etablissements USING GIST(geom);

-- Index filtres temporels
CREATE INDEX idx_evt_annee_trim ON evenements_etablissements(annee, trimestre);
CREATE INDEX idx_evt_type ON evenements_etablissements(type_evenement);
CREATE INDEX idx_evt_siret ON evenements_etablissements(siret);
CREATE INDEX idx_stats_annee_trim ON stats_communes(annee, trimestre, section_naf);
CREATE INDEX idx_stats_commune ON stats_communes(code_commune);

-- Index filtres métier
CREATE INDEX idx_etab_commune ON etablissements(code_commune);
CREATE INDEX idx_etab_section_naf ON etablissements(section_naf);
CREATE INDEX idx_etab_etat ON etablissements(etat_admin);
CREATE INDEX idx_etab_date_creation ON etablissements(date_creation);
CREATE INDEX idx_etab_date_fermeture ON etablissements(date_fermeture);
CREATE INDEX idx_hist_siret ON historique_etablissements(siret);
CREATE INDEX idx_hist_variable ON historique_etablissements(variable);

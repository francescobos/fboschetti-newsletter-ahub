DROP TABLE IF EXISTS righe;

CREATE TABLE aziende (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nome          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  settore       TEXT,
  sito          TEXT,
  indirizzo_raw TEXT,
  via           TEXT,
  comune        TEXT,
  provincia     TEXT,
  regione       TEXT,
  cap           TEXT,
  lat           REAL,
  lon           REAL,
  note          TEXT,
  creato_il     INTEGER NOT NULL,
  aggiornato_il INTEGER NOT NULL
);

CREATE TABLE contatti (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nome            TEXT,
  cognome         TEXT,
  azienda_id      INTEGER REFERENCES aziende(id) ON DELETE SET NULL,
  ruolo           TEXT,
  indirizzo_raw   TEXT,
  via             TEXT,
  comune          TEXT,
  provincia       TEXT,
  regione         TEXT,
  cap             TEXT,
  lat             REAL,
  lon             REAL,
  iscritto        INTEGER NOT NULL DEFAULT 1,
  stato_tecnico   TEXT NOT NULL DEFAULT 'mai_verificato'
                  CHECK (stato_tecnico IN
                    ('mai_verificato','valido','rimbalzato','sospeso')),
  provenienza     TEXT,
  creato_il       INTEGER NOT NULL,
  aggiornato_il   INTEGER NOT NULL,
  disiscritto_il  INTEGER,
  disiscritto_via TEXT CHECK (disiscritto_via IS NULL OR disiscritto_via IN
                    ('telefono','email','manuale','ponte'))
);

CREATE TABLE tag (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE contatti_tag (
  contatto_id INTEGER NOT NULL REFERENCES contatti(id) ON DELETE CASCADE,
  tag_id      INTEGER NOT NULL REFERENCES tag(id)      ON DELETE CASCADE,
  PRIMARY KEY (contatto_id, tag_id)
);

CREATE TABLE import_csv (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  eseguito_il INTEGER NOT NULL,
  origine     TEXT    NOT NULL,
  righe_lette INTEGER NOT NULL,
  creati      INTEGER NOT NULL,
  aggiornati  INTEGER NOT NULL,
  rapporto    TEXT    NOT NULL
);

CREATE INDEX idx_contatti_azienda   ON contatti(azienda_id);
CREATE INDEX idx_contatti_iscritto  ON contatti(iscritto);
CREATE INDEX idx_contatti_comune    ON contatti(comune);
CREATE INDEX idx_contatti_provincia ON contatti(provincia);
CREATE INDEX idx_aziende_provincia  ON aziende(provincia);

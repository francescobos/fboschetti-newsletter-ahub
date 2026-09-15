-- Un'edizione è una coppia .txt + .html pronta per la spedizione.
-- `ref` è UNIQUE anche qui, non solo nel core: la protezione del core scatta
-- all'accodamento, questa all'ingestione, quando l'errore costa ancora nulla.
CREATE TABLE edizioni (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ref              TEXT NOT NULL UNIQUE,
  oggetto          TEXT NOT NULL,
  testo            TEXT NOT NULL,
  html             TEXT NOT NULL,
  percorso_origine TEXT,
  stato            TEXT NOT NULL DEFAULT 'bozza'
                   CHECK (stato IN ('bozza','pronta','in_invio','inviata')),
  campagna_id      TEXT,
  avviso_mailto    TEXT,
  filtro_tag       TEXT,
  destinatari_n    INTEGER,
  creato_il        INTEGER NOT NULL,
  aggiornato_il    INTEGER NOT NULL,
  accodata_il      INTEGER,
  avviata_il       INTEGER
);

CREATE INDEX idx_edizioni_stato ON edizioni(stato);

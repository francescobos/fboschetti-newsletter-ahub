import type { Database } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import {
  disiscrivi,
  elencaAziende,
  elencaContatti,
  leggiContatto,
  trovaPerEmail,
} from "../server/contatti";
import { importaCsv, storicoImport } from "../server/import";
import { creaDbDiTest } from "./helpers";

let db: Database;
beforeEach(() => {
  db = creaDbDiTest();
});

const CSV = `email,nome,cognome,azienda,ruolo,tag,provenienza
mario@esempio.it,Mario,Rossi,Villaggio Sole,Direttore,"villaggi,pilota",export
lucia@esempio.it,Lucia,Bianchi,Villaggio Sole,Marketing,villaggi,export`;

test("il primo import crea i contatti", () => {
  const esito = importaCsv(db, CSV);
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.rapporto.creati).toBe(2);
  expect(esito.rapporto.aggiornati).toBe(0);
  expect(esito.rapporto.righeLette).toBe(2);
  expect(elencaContatti(db).totale).toBe(2);
});

test("reimportare lo stesso file non crea doppioni", () => {
  importaCsv(db, CSV);
  const esito = importaCsv(db, CSV);
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.rapporto.creati).toBe(0);
  expect(esito.rapporto.aggiornati).toBe(2);
  expect(elencaContatti(db).totale).toBe(2);
});

// Il criterio di "fatto" della fase.
test("un disiscritto resta disiscritto dopo il reimport", () => {
  importaCsv(db, CSV);
  const c = trovaPerEmail(db, "mario@esempio.it")!;
  disiscrivi(db, c.id, "telefono");
  const primaDelReimport = trovaPerEmail(db, "mario@esempio.it")!;

  const esito = importaCsv(db, CSV);
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.rapporto.disiscrittiIntatti).toBe(1);

  const dopo = trovaPerEmail(db, "mario@esempio.it")!;
  expect(dopo.iscritto).toBe(false);
  expect(dopo.disiscrittoVia).toBe("telefono");
  expect(dopo.disiscrittoIl).toBe(primaDelReimport.disiscrittoIl);
});

test("su un disiscritto l'import aggiorna comunque i dati anagrafici", () => {
  importaCsv(db, "email,nome\nmario@esempio.it,Mario");
  const c = trovaPerEmail(db, "mario@esempio.it")!;
  disiscrivi(db, c.id, "email");

  importaCsv(db, "email,nome,ruolo\nmario@esempio.it,Mario,Direttore");
  const dopo = trovaPerEmail(db, "mario@esempio.it")!;
  expect(dopo.ruolo).toBe("Direttore");
  expect(dopo.iscritto).toBe(false);
});

test("l'email con maiuscole diverse è lo stesso contatto", () => {
  importaCsv(db, "email\nmario@esempio.it");
  const esito = importaCsv(db, "email\nMario@Esempio.IT");
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.rapporto.creati).toBe(0);
  expect(elencaContatti(db).totale).toBe(1);
});

test("i tag si uniscono, non sostituiscono", () => {
  importaCsv(db, `email,tag\nmario@esempio.it,villaggi`);
  importaCsv(db, `email,tag\nmario@esempio.it,pilota`);
  const c = trovaPerEmail(db, "mario@esempio.it")!;
  expect(c.tag.sort()).toEqual(["pilota", "villaggi"]);
});

test("un campo vuoto non cancella il valore esistente", () => {
  importaCsv(db, "email,nome,ruolo\nmario@esempio.it,Mario,Direttore");
  importaCsv(db, "email,nome,ruolo\nmario@esempio.it,,");
  const c = trovaPerEmail(db, "mario@esempio.it")!;
  expect(c.nome).toBe("Mario");
  expect(c.ruolo).toBe("Direttore");
});

test("un campo pieno sovrascrive il valore esistente", () => {
  importaCsv(db, "email,ruolo\nmario@esempio.it,Direttore");
  importaCsv(db, "email,ruolo\nmario@esempio.it,Presidente");
  expect(trovaPerEmail(db, "mario@esempio.it")!.ruolo).toBe("Presidente");
});

test("l'azienda si crea una volta sola per due contatti", () => {
  const esito = importaCsv(db, CSV);
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.rapporto.aziendeCreate).toBe(1);
  expect(elencaAziende(db)).toHaveLength(1);
  expect(trovaPerEmail(db, "mario@esempio.it")!.aziendaNome).toBe(
    "Villaggio Sole",
  );
});

test("l'azienda non si duplica per differenza di maiuscole", () => {
  importaCsv(db, "email,azienda\nmario@esempio.it,Villaggio Sole");
  importaCsv(db, "email,azienda\nlucia@esempio.it,villaggio sole");
  expect(elencaAziende(db)).toHaveLength(1);
});

test("un CSV rifiutato non scrive nulla", () => {
  importaCsv(db, "email\nmario@esempio.it");
  const esito = importaCsv(
    db,
    "email\nlucia@esempio.it\nnon-una-email\nanna@esempio.it",
  );
  expect(esito.ok).toBe(false);
  expect(elencaContatti(db).totale).toBe(1);
});

test("il dry-run non scrive ma calcola lo stesso rapporto", () => {
  const prova = importaCsv(db, CSV, { dryRun: true });
  expect(prova.ok).toBe(true);
  if (!prova.ok) return;
  expect(prova.rapporto.creati).toBe(2);
  expect(elencaContatti(db).totale).toBe(0);

  const vero = importaCsv(db, CSV);
  expect(vero.ok).toBe(true);
  if (!vero.ok) return;
  expect(vero.rapporto).toEqual(prova.rapporto);
});

test("il dry-run non lascia aziende né tag dietro di sé", () => {
  importaCsv(db, CSV, { dryRun: true });
  expect(elencaAziende(db)).toHaveLength(0);
  const n = db.query("SELECT COUNT(*) AS n FROM tag").get() as { n: number };
  expect(n.n).toBe(0);
});

test("l'import reale finisce nello storico, il dry-run no", () => {
  importaCsv(db, CSV, { origine: "prova.csv", dryRun: true });
  expect(storicoImport(db)).toHaveLength(0);

  importaCsv(db, CSV, { origine: "prova.csv" });
  const storico = storicoImport(db);
  expect(storico).toHaveLength(1);
  expect(storico[0]!.origine).toBe("prova.csv");
  expect(storico[0]!.creati).toBe(2);
});

test("i contatti importati nascono iscritti", () => {
  importaCsv(db, CSV);
  expect(trovaPerEmail(db, "mario@esempio.it")!.iscritto).toBe(true);
});

test("l'indirizzo grezzo si conserva com'è", () => {
  const raw = "Via Zenzalino Nord, 145 Budrio 40054 (BO)";
  importaCsv(db, `email,indirizzo_raw\nmario@esempio.it,"${raw}"`);
  expect(trovaPerEmail(db, "mario@esempio.it")!.indirizzoRaw).toBe(raw);
});

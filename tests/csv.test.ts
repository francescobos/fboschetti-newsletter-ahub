import { expect, test } from "bun:test";
import { emailValida, normalizzaEmail, parseCsv } from "../server/csv";

const INTESTAZIONE =
  "email,nome,cognome,azienda,ruolo,tag,provenienza,indirizzo_raw";

test("legge una riga completa", () => {
  const esito = parseCsv(
    `${INTESTAZIONE}\nmario@esempio.it,Mario,Rossi,Villaggio Sole,Direttore,"villaggi,pilota",export-2026,"Via Roma 1, Budrio (BO)"`,
  );
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  const r = esito.righe[0]!;
  expect(r.email).toBe("mario@esempio.it");
  expect(r.nome).toBe("Mario");
  expect(r.cognome).toBe("Rossi");
  expect(r.azienda).toBe("Villaggio Sole");
  expect(r.ruolo).toBe("Direttore");
  expect(r.tag).toEqual(["villaggi", "pilota"]);
  expect(r.provenienza).toBe("export-2026");
  expect(r.indirizzoRaw).toBe("Via Roma 1, Budrio (BO)");
});

test("i campi fra virgolette conservano le virgole", () => {
  const esito = parseCsv(
    `email,tag\nmario@esempio.it,"villaggi,pilota,nord"`,
  );
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.righe[0]!.tag).toEqual(["villaggi", "pilota", "nord"]);
});

test("le virgolette doppie interne si riducono a una", () => {
  const esito = parseCsv(`email,nome\nmario@esempio.it,"Mario ""il Grande"""`);
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.righe[0]!.nome).toBe('Mario "il Grande"');
});

test("bastano le colonne che servono", () => {
  const esito = parseCsv("email\nmario@esempio.it");
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.righe[0]!.email).toBe("mario@esempio.it");
  expect(esito.righe[0]!.tag).toEqual([]);
});

test("l'email si normalizza a minuscolo e trimmata", () => {
  const esito = parseCsv("email\n  Mario@Esempio.IT  ");
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.righe[0]!.email).toBe("mario@esempio.it");
});

test("senza la colonna email il file è rifiutato", () => {
  const esito = parseCsv("nome,cognome\nMario,Rossi");
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toContain("email");
});

test("una colonna sconosciuta fa rifiutare il file", () => {
  const esito = parseCsv("email,telefono\nmario@esempio.it,123");
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toContain("telefono");
});

test("un'email non valida fa rifiutare il file e dice quale riga", () => {
  const esito = parseCsv(
    "email\nmario@esempio.it\nnon-una-email\nlucia@esempio.it",
  );
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toContain("3"); // riga 3 del file, intestazione inclusa
});

test("un'email vuota fa rifiutare il file", () => {
  const esito = parseCsv("email,nome\n,Mario");
  expect(esito.ok).toBe(false);
});

test("le righe vuote si ignorano senza far fallire", () => {
  const esito = parseCsv("email\nmario@esempio.it\n\n\nlucia@esempio.it\n");
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.righe).toHaveLength(2);
});

test("un file con la sola intestazione dà zero righe", () => {
  const esito = parseCsv(INTESTAZIONE);
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.righe).toHaveLength(0);
});

test("i campi vuoti restano undefined, non stringa vuota", () => {
  const esito = parseCsv("email,nome,cognome\nmario@esempio.it,,");
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.righe[0]!.nome).toBeUndefined();
  expect(esito.righe[0]!.cognome).toBeUndefined();
});

test("i tag si normalizzano: trim, minuscolo, niente vuoti", () => {
  const esito = parseCsv(`email,tag\nmario@esempio.it," Villaggi , PILOTA ,, "`);
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.righe[0]!.tag).toEqual(["villaggi", "pilota"]);
});

test("il CRLF di Windows non finisce nei valori", () => {
  const esito = parseCsv("email,nome\r\nmario@esempio.it,Mario\r\n");
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.righe[0]!.nome).toBe("Mario");
});

test("emailValida accetta e rifiuta i casi ovvi", () => {
  expect(emailValida("mario@esempio.it")).toBe(true);
  expect(emailValida("mario.rossi+tag@sub.esempio.co.uk")).toBe(true);
  expect(emailValida("non-una-email")).toBe(false);
  expect(emailValida("senza@dominio")).toBe(false);
  expect(emailValida("@esempio.it")).toBe(false);
  expect(emailValida("con spazio@esempio.it")).toBe(false);
});

test("normalizzaEmail trimma e abbassa", () => {
  expect(normalizzaEmail("  Mario@Esempio.IT ")).toBe("mario@esempio.it");
});

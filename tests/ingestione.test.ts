import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { leggiEdizione } from "../server/edizioni";
import { ingestaDaPercorso, verificaMailto } from "../server/ingestione";
import { creaDbDiTest } from "./helpers";

let db: Database;
let dir: string;

const TESTO = `Novità di settembre.

Se non vuoi più riceverla: mailto:redazione@esempio.it?subject=Vorrei%20disiscrivermi`;

const HTML = `<p>Novità di settembre.</p>
<p><a href="mailto:redazione@esempio.it?subject=Vorrei%20disiscrivermi">Disiscriviti</a></p>`;

beforeEach(() => {
  db = creaDbDiTest();
  dir = mkdtempSync(join(tmpdir(), "ingestione-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function scriviCoppia(nome: string, testo = TESTO, html = HTML): string {
  writeFileSync(join(dir, `${nome}.txt`), testo);
  writeFileSync(join(dir, `${nome}.html`), html);
  return dir;
}

test("una coppia completa in una directory entra come edizione", () => {
  scriviCoppia("newsletter");
  const esito = ingestaDaPercorso(db, {
    percorso: dir,
    ref: "newsletter-2026-09",
    oggetto: "Novità di settembre",
  });
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  const e = leggiEdizione(db, esito.id)!;
  expect(e.stato).toBe("bozza");
  expect(e.testo).toBe(TESTO);
  expect(e.html).toBe(HTML);
  expect(e.avvisoMailto).toBeNull();
});

test("il ref si normalizza e l'esito riporta quello effettivo", () => {
  scriviCoppia("newsletter");
  const esito = ingestaDaPercorso(db, {
    percorso: dir,
    ref: "  Newsletter Settembre 2026 ",
    oggetto: "Oggetto",
  });
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.ref).toBe("newsletter-settembre-2026");
  expect(leggiEdizione(db, esito.id)!.ref).toBe("newsletter-settembre-2026");
});

test("indicare il .txt trova l'.html con la stessa radice", () => {
  scriviCoppia("newsletter");
  const esito = ingestaDaPercorso(db, {
    percorso: join(dir, "newsletter.txt"),
    ref: "r1",
    oggetto: "Oggetto",
  });
  expect(esito.ok).toBe(true);
});

test("indicare l'.html trova il .txt con la stessa radice", () => {
  scriviCoppia("newsletter");
  const esito = ingestaDaPercorso(db, {
    percorso: join(dir, "newsletter.html"),
    ref: "r1",
    oggetto: "Oggetto",
  });
  expect(esito.ok).toBe(true);
});

test("una coppia incompleta non entra", () => {
  writeFileSync(join(dir, "solo.txt"), TESTO);
  const esito = ingestaDaPercorso(db, {
    percorso: dir,
    ref: "r1",
    oggetto: "Oggetto",
  });
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("coppia_incompleta");
});

test("un percorso inesistente dà errore, non un'eccezione", () => {
  const esito = ingestaDaPercorso(db, {
    percorso: join(dir, "non-esiste"),
    ref: "r1",
    oggetto: "Oggetto",
  });
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("percorso_inesistente");
});

test("due file .txt nella stessa directory sono un'ambiguità, non una scelta", () => {
  scriviCoppia("uno");
  scriviCoppia("due");
  const esito = ingestaDaPercorso(db, {
    percorso: dir,
    ref: "r1",
    oggetto: "Oggetto",
  });
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("coppia_ambigua");
});

test("un ref già usato non entra due volte", () => {
  scriviCoppia("newsletter");
  ingestaDaPercorso(db, { percorso: dir, ref: "r1", oggetto: "Oggetto" });
  const esito = ingestaDaPercorso(db, {
    percorso: dir,
    ref: "r1",
    oggetto: "Oggetto",
  });
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("ref_gia_presente");
});

test("un ref che si normalizza a vuoto è rifiutato", () => {
  scriviCoppia("newsletter");
  const esito = ingestaDaPercorso(db, {
    percorso: dir,
    ref: "!!!",
    oggetto: "Oggetto",
  });
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("ref_non_valido");
});

test("un oggetto vuoto è rifiutato", () => {
  scriviCoppia("newsletter");
  const esito = ingestaDaPercorso(db, {
    percorso: dir,
    ref: "r1",
    oggetto: "   ",
  });
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("oggetto_mancante");
});

test("un file vuoto è rifiutato", () => {
  scriviCoppia("newsletter", "", HTML);
  const esito = ingestaDaPercorso(db, {
    percorso: dir,
    ref: "r1",
    oggetto: "Oggetto",
  });
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("corpo_vuoto");
});

test("senza mailto l'edizione entra, ma con l'avviso", () => {
  scriviCoppia("newsletter", "Solo testo.", "<p>Solo html.</p>");
  const esito = ingestaDaPercorso(db, {
    percorso: dir,
    ref: "r1",
    oggetto: "Oggetto",
  });
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.avvisoMailto).not.toBeNull();
  expect(leggiEdizione(db, esito.id)!.avvisoMailto).toContain("testo");
});

test("il mailto in uno solo dei due corpi avvisa comunque", () => {
  scriviCoppia("newsletter", "Solo testo, niente link.", HTML);
  const esito = ingestaDaPercorso(db, {
    percorso: dir,
    ref: "r1",
    oggetto: "Oggetto",
  });
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.avvisoMailto).toContain("testo");
});

test("verificaMailto tace quando entrambi i corpi ce l'hanno", () => {
  expect(verificaMailto(TESTO, HTML)).toBeNull();
});

test("verificaMailto nomina entrambi i corpi quando mancano entrambi", () => {
  const avviso = verificaMailto("niente", "<p>niente</p>")!;
  expect(avviso).toContain("testo");
  expect(avviso).toContain("HTML");
});

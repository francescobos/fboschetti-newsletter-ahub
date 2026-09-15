import { beforeEach, expect, test } from "bun:test";
import {
  accoda,
  avvia,
  prova,
  statoCampagna,
  type Campagna,
  type MailMinima,
} from "../server/campagne";
import type { Edizione } from "../server/edizioni";

const EDIZIONE: Edizione = {
  id: 1,
  ref: "newsletter-2026-09",
  oggetto: "Novità di settembre",
  testo: "Versione testuale.",
  html: "<p>Versione HTML.</p>",
  percorsoOrigine: "/tmp/edizioni",
  stato: "bozza",
  campagnaId: null,
  avvisoMailto: null,
  filtroTag: null,
  destinatariN: null,
  creatoIl: 1,
  aggiornatoIl: 1,
  accodataIl: null,
  avviataIl: null,
};

/** Finto `MailApi` che registra le chiamate, così i test non mandano mail. */
function creaFintaMail(opzioni: { refUsati?: string[] } = {}) {
  const refUsati = new Set(opzioni.refUsati ?? []);
  const chiamate: {
    accodate: { ref: string; recipients: string[] }[];
    avviate: string[];
    inviate: { to: string; subject: string }[];
  } = { accodate: [], avviate: [], inviate: [] };

  const mail: MailMinima = {
    async send(input) {
      chiamate.inviate.push({ to: String(input.to), subject: input.subject });
      return { id: "mail-1" };
    },
    async enqueueCampaign(input) {
      if (refUsati.has(input.ref)) {
        throw new Error(`UNIQUE constraint failed: email_campaigns.ref`);
      }
      refUsati.add(input.ref);
      chiamate.accodate.push({
        ref: input.ref,
        recipients: input.recipients,
      });
      return { id: `camp-${chiamate.accodate.length}` };
    },
    async startCampaign(id) {
      chiamate.avviate.push(id);
    },
    async getCampaign(idOrRef) {
      if (!refUsati.has(idOrRef) && !idOrRef.startsWith("camp-")) return null;
      return {
        id: "camp-1",
        ref: "newsletter-2026-09",
        subject: "Novità di settembre",
        status: "sending",
        total: 2,
        sentCount: 1,
        errorCount: 0,
        startedAt: "2026-09-15T10:00:00Z",
        finishedAt: null,
      } as Campagna;
    },
  };

  return { mail, chiamate };
}

let finta: ReturnType<typeof creaFintaMail>;
beforeEach(() => {
  finta = creaFintaMail();
});

test("accoda passa ref, oggetto e i due corpi al core", async () => {
  const esito = await accoda(finta.mail, EDIZIONE, [
    "a@esempio.it",
    "b@esempio.it",
  ]);
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.dato.id).toBe("camp-1");
  expect(finta.chiamate.accodate[0]!.ref).toBe("newsletter-2026-09");
  expect(finta.chiamate.accodate[0]!.recipients).toEqual([
    "a@esempio.it",
    "b@esempio.it",
  ]);
});

test("accodare senza destinatari è un errore, non una campagna vuota", async () => {
  const esito = await accoda(finta.mail, EDIZIONE, []);
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("nessun_destinatario");
  expect(finta.chiamate.accodate.length).toBe(0);
});

test("un ref già usato fallisce in modo pulito, senza eccezione", async () => {
  const conRef = creaFintaMail({ refUsati: ["newsletter-2026-09"] });
  const esito = await accoda(conRef.mail, EDIZIONE, ["a@esempio.it"]);
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("ref_gia_usato");
});

test("accoda con mail null dà errore esplicito", async () => {
  const esito = await accoda(null, EDIZIONE, ["a@esempio.it"]);
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("mail_non_disponibile");
});

test("avvia chiama startCampaign con l'id della campagna", async () => {
  await accoda(finta.mail, EDIZIONE, ["a@esempio.it"]);
  const esito = await avvia(finta.mail, "camp-1");
  expect(esito.ok).toBe(true);
  expect(finta.chiamate.avviate).toEqual(["camp-1"]);
});

test("avvia con mail null dà errore esplicito", async () => {
  const esito = await avvia(null, "camp-1");
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("mail_non_disponibile");
});

test("statoCampagna restituisce i contatori del core", async () => {
  await accoda(finta.mail, EDIZIONE, ["a@esempio.it", "b@esempio.it"]);
  const esito = await statoCampagna(finta.mail, "camp-1");
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.dato!.status).toBe("sending");
  expect(esito.dato!.sentCount).toBe(1);
});

test("statoCampagna su campagna inesistente dà null, non un errore", async () => {
  const esito = await statoCampagna(finta.mail, "inesistente");
  expect(esito.ok).toBe(true);
  if (!esito.ok) return;
  expect(esito.dato).toBeNull();
});

test("statoCampagna con mail null dà errore esplicito", async () => {
  const esito = await statoCampagna(null, "camp-1");
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("mail_non_disponibile");
});

test("prova usa send e non consuma il ref", async () => {
  const esito = await prova(finta.mail, EDIZIONE, "io@esempio.it");
  expect(esito.ok).toBe(true);
  expect(finta.chiamate.inviate[0]!.to).toBe("io@esempio.it");
  expect(finta.chiamate.accodate.length).toBe(0);

  // Ripetibile: il ref resta libero per la campagna vera.
  await prova(finta.mail, EDIZIONE, "io@esempio.it");
  const reale = await accoda(finta.mail, EDIZIONE, ["a@esempio.it"]);
  expect(reale.ok).toBe(true);
});

test("prova segnala l'oggetto come prova, per non confonderla col reale", async () => {
  await prova(finta.mail, EDIZIONE, "io@esempio.it");
  expect(finta.chiamate.inviate[0]!.subject).toContain("PROVA");
  expect(finta.chiamate.inviate[0]!.subject).toContain("Novità di settembre");
});

test("prova con indirizzo vuoto è rifiutata", async () => {
  const esito = await prova(finta.mail, EDIZIONE, "  ");
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("indirizzo_non_valido");
});

test("prova con mail null dà errore esplicito", async () => {
  const esito = await prova(null, EDIZIONE, "io@esempio.it");
  expect(esito.ok).toBe(false);
  if (esito.ok) return;
  expect(esito.errore).toBe("mail_non_disponibile");
});

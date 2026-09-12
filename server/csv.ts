/**
 * Parsing e validazione del CSV dei contatti.
 *
 * Funzioni pure: non toccano il DB e non importano nulla di `@hub/*`.
 *
 * Il parser gestisce le virgolette perché i tag arrivano in un solo campo
 * (`"villaggi,pilota"`): uno split sulla virgola li spezzerebbe e sfaserebbe
 * l'intera riga.
 */

export type RigaCsv = {
  email: string;
  nome?: string;
  cognome?: string;
  azienda?: string;
  ruolo?: string;
  tag: string[];
  provenienza?: string;
  indirizzoRaw?: string;
};

export type EsitoCsv =
  | { ok: true; righe: RigaCsv[] }
  | { ok: false; errore: string };

const COLONNE_NOTE = [
  "email",
  "nome",
  "cognome",
  "azienda",
  "ruolo",
  "tag",
  "provenienza",
  "indirizzo_raw",
] as const;

export function normalizzaEmail(valore: string): string {
  return valore.trim().toLowerCase();
}

export function emailValida(valore: string): boolean {
  return /^[^\s@,]+@[^\s@,]+\.[^\s@,]{2,}$/.test(valore);
}

/** Divide una riga CSV rispettando le virgolette. `""` interno vale `"`. */
function dividiRiga(riga: string): string[] {
  const campi: string[] = [];
  let corrente = "";
  let fraVirgolette = false;

  for (let i = 0; i < riga.length; i++) {
    const c = riga[i]!;
    if (fraVirgolette) {
      if (c === '"') {
        if (riga[i + 1] === '"') {
          corrente += '"';
          i++;
        } else {
          fraVirgolette = false;
        }
      } else {
        corrente += c;
      }
    } else if (c === '"') {
      fraVirgolette = true;
    } else if (c === ",") {
      campi.push(corrente);
      corrente = "";
    } else {
      corrente += c;
    }
  }
  campi.push(corrente);
  return campi;
}

/** Stringa vuota o solo spazi diventa undefined: un campo vuoto non è un dato. */
function opzionale(valore: string | undefined): string | undefined {
  const v = valore?.trim();
  return v ? v : undefined;
}

function parseTag(valore: string | undefined): string[] {
  if (!valore) return [];
  return valore
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
}

export function parseCsv(testo: string): EsitoCsv {
  const righeTesto = testo.replace(/\r\n/g, "\n").split("\n");
  const primaNonVuota = righeTesto.findIndex((r) => r.trim().length > 0);
  if (primaNonVuota === -1) return { ok: false, errore: "il file è vuoto" };

  const intestazione = dividiRiga(righeTesto[primaNonVuota]!).map((c) =>
    c.trim().toLowerCase(),
  );

  const ignote = intestazione.filter(
    (c) => !COLONNE_NOTE.includes(c as (typeof COLONNE_NOTE)[number]),
  );
  if (ignote.length > 0) {
    return {
      ok: false,
      errore: `colonne non riconosciute: ${ignote.join(", ")}. Attese: ${COLONNE_NOTE.join(", ")}`,
    };
  }
  if (!intestazione.includes("email")) {
    return { ok: false, errore: "manca la colonna obbligatoria: email" };
  }

  const indice = (nome: string) => intestazione.indexOf(nome);
  const campo = (campi: string[], nome: string): string | undefined => {
    const i = indice(nome);
    return i === -1 ? undefined : campi[i];
  };

  const righe: RigaCsv[] = [];
  for (let n = primaNonVuota + 1; n < righeTesto.length; n++) {
    const testoRiga = righeTesto[n]!;
    if (testoRiga.trim().length === 0) continue;

    const campi = dividiRiga(testoRiga);
    const email = normalizzaEmail(campo(campi, "email") ?? "");
    // Numero di riga umano: 1-based, intestazione inclusa.
    const numeroRiga = n + 1;
    if (!email) {
      return { ok: false, errore: `riga ${numeroRiga}: email mancante` };
    }
    if (!emailValida(email)) {
      return {
        ok: false,
        errore: `riga ${numeroRiga}: email non valida (${email})`,
      };
    }

    righe.push({
      email,
      nome: opzionale(campo(campi, "nome")),
      cognome: opzionale(campo(campi, "cognome")),
      azienda: opzionale(campo(campi, "azienda")),
      ruolo: opzionale(campo(campi, "ruolo")),
      tag: parseTag(opzionale(campo(campi, "tag"))),
      provenienza: opzionale(campo(campi, "provenienza")),
      indirizzoRaw: opzionale(campo(campi, "indirizzo_raw")),
    });
  }

  return { ok: true, righe };
}

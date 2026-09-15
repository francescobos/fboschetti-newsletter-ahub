import type { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { creaEdizione, normalizzaRef, trovaPerRef } from "./edizioni";

/**
 * Ingestione della coppia `.txt` + `.html` da un percorso su disco.
 *
 * È il punto d'ingresso che l'agente dei contenuti userà. La Fase 2 innesterà
 * qui il validatore deterministico senza cambiarne la firma.
 */

export type OpzioniIngestione = {
  percorso: string;
  ref: string;
  oggetto: string;
};

export type EsitoIngestione =
  | { ok: true; id: number; ref: string; avvisoMailto: string | null }
  | { ok: false; errore: string };

/**
 * Cerca un `mailto:` di disiscrizione nei due corpi.
 *
 * Avvisa, non blocca: i corpi li scrive l'agente dei contenuti e il plugin
 * non li modifica mai. Un blocco duro in questa fase fermerebbe l'invio per
 * un dettaglio di formattazione.
 *
 * Non verifica a quale indirizzo punti: `mailFrom` è configurazione del core
 * e non è esposta al plugin.
 */
export function verificaMailto(testo: string, html: string): string | null {
  const mancanti: string[] = [];
  if (!/mailto:/i.test(testo)) mancanti.push("testo");
  if (!/mailto:/i.test(html)) mancanti.push("HTML");
  if (mancanti.length === 0) return null;
  return `Nessun link mailto: di disiscrizione trovato nel corpo ${mancanti.join(" e nel corpo ")}.`;
}

/** La coppia di file trovata a partire dal percorso indicato. */
type Coppia = { testo: string; html: string };

function trovaCoppia(percorso: string): Coppia | { errore: string } {
  if (!existsSync(percorso)) return { errore: "percorso_inesistente" };

  // Un file indicato: l'altro ha la stessa radice nella stessa directory.
  if (statSync(percorso).isFile()) {
    const radice = percorso.replace(/\.(txt|html)$/i, "");
    const txt = `${radice}.txt`;
    const html = `${radice}.html`;
    if (!existsSync(txt) || !existsSync(html)) {
      return { errore: "coppia_incompleta" };
    }
    return { testo: txt, html };
  }

  // Una directory: deve contenere esattamente una coppia.
  const file = readdirSync(percorso);
  const txt = file.filter((n) => n.toLowerCase().endsWith(".txt"));
  const html = file.filter((n) => n.toLowerCase().endsWith(".html"));
  if (txt.length === 0 || html.length === 0) {
    return { errore: "coppia_incompleta" };
  }
  // Più coppie non sono una scelta da indovinare: chi chiama indichi il file.
  if (txt.length > 1 || html.length > 1) return { errore: "coppia_ambigua" };
  return { testo: join(percorso, txt[0]!), html: join(percorso, html[0]!) };
}

export function ingestaDaPercorso(
  db: Database,
  opzioni: OpzioniIngestione,
): EsitoIngestione {
  const ref = normalizzaRef(opzioni.ref);
  if (!ref) return { ok: false, errore: "ref_non_valido" };
  if (!opzioni.oggetto.trim()) return { ok: false, errore: "oggetto_mancante" };
  if (trovaPerRef(db, ref)) return { ok: false, errore: "ref_gia_presente" };

  const coppia = trovaCoppia(opzioni.percorso);
  if ("errore" in coppia) return { ok: false, errore: coppia.errore };

  const testo = readFileSync(coppia.testo, "utf8");
  const html = readFileSync(coppia.html, "utf8");
  if (!testo.trim() || !html.trim()) {
    return { ok: false, errore: "corpo_vuoto" };
  }

  const avvisoMailto = verificaMailto(testo, html);
  const id = creaEdizione(db, {
    ref,
    oggetto: opzioni.oggetto.trim(),
    testo,
    html,
    percorsoOrigine: dirname(coppia.testo),
    avvisoMailto,
  });

  return { ok: true, id, ref, avvisoMailto };
}

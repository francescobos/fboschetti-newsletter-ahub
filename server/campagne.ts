import type { Edizione } from "./edizioni";

/**
 * Wrapper sul servizio mail del core.
 *
 * Non tocca il DB: riceve l'edizione e la lista dei destinatari già risolta.
 * È questa separazione che permette di testare l'accodamento senza il DB dei
 * contatti, e la risoluzione senza il core.
 *
 * Il ritmo d'invio, i retry sui transitori, la ripresa dopo riavvio e
 * l'idempotenza sono del core: qui non si ricostruisce nulla di tutto ciò.
 */

/** Ciò che il core restituisce su una campagna. Solo i campi che usiamo. */
export type Campagna = {
  id: string;
  ref: string;
  subject: string;
  status: "queued" | "sending" | "paused" | "sent" | "sent_with_errors";
  total: number;
  sentCount: number;
  errorCount: number;
  startedAt: string | null;
  finishedAt: string | null;
};

/**
 * Il sottoinsieme di `MailApi` che serve a questo modulo.
 *
 * `@hub/mail-api` esiste solo quando il plugin gira dentro il core, quindi
 * non è risolvibile da `bun run check` né dai test. Un tipo strutturale
 * risolve entrambi: `MailApi` lo soddisfa, e i test possono passare un finto.
 */
export type MailMinima = {
  send(input: {
    to: string | string[];
    subject: string;
    text?: string;
    html?: string;
  }): Promise<{ id: string }>;
  enqueueCampaign(input: {
    ref: string;
    subject: string;
    text?: string;
    html?: string;
    recipients: string[];
  }): Promise<{ id: string }>;
  startCampaign(id: string): Promise<void>;
  getCampaign(idOrRef: string): Promise<Campagna | null>;
};

export type EsitoCampagna<T> =
  | { ok: true; dato: T }
  | { ok: false; errore: string };

/** Vero solo per la violazione di unicità sul `ref` delle campagne. */
function eRefDuplicato(errore: unknown): boolean {
  const messaggio = errore instanceof Error ? errore.message : String(errore);
  return /UNIQUE constraint failed[^]*ref|ref.*(gi[aà] (usato|presente)|duplicat)/i.test(
    messaggio,
  );
}

/**
 * Accoda la campagna nel core. **Non spedisce**: serve `avvia`.
 *
 * Il `ref` è quello dell'edizione, derivato dalla sua identità e mai dal
 * tempo: è ciò che rende sicuro rilanciare l'accodamento.
 */
export async function accoda(
  mail: MailMinima | null,
  edizione: Edizione,
  destinatari: string[],
): Promise<EsitoCampagna<{ id: string }>> {
  if (!mail) return { ok: false, errore: "mail_non_disponibile" };
  if (destinatari.length === 0) {
    return { ok: false, errore: "nessun_destinatario" };
  }
  try {
    const { id } = await mail.enqueueCampaign({
      ref: edizione.ref,
      subject: edizione.oggetto,
      text: edizione.testo,
      html: edizione.html,
      recipients: destinatari,
    });
    return { ok: true, dato: { id } };
  } catch (e) {
    if (eRefDuplicato(e)) return { ok: false, errore: "ref_gia_usato" };
    const messaggio = e instanceof Error ? e.message : String(e);
    return { ok: false, errore: `accodamento_fallito: ${messaggio}` };
  }
}

/** Da qui il core comincia a drenare la campagna. */
export async function avvia(
  mail: MailMinima | null,
  campagnaId: string,
): Promise<EsitoCampagna<null>> {
  if (!mail) return { ok: false, errore: "mail_non_disponibile" };
  try {
    await mail.startCampaign(campagnaId);
    return { ok: true, dato: null };
  } catch (e) {
    const messaggio = e instanceof Error ? e.message : String(e);
    return { ok: false, errore: `avvio_fallito: ${messaggio}` };
  }
}

/**
 * Lo stato della campagna secondo il core.
 *
 * I contatori si leggono, non si duplicano: `in_invio` e `inviata` non sono
 * verità del plugin.
 */
export async function statoCampagna(
  mail: MailMinima | null,
  idOrRef: string,
): Promise<EsitoCampagna<Campagna | null>> {
  if (!mail) return { ok: false, errore: "mail_non_disponibile" };
  try {
    return { ok: true, dato: await mail.getCampaign(idOrRef) };
  } catch (e) {
    const messaggio = e instanceof Error ? e.message : String(e);
    return { ok: false, errore: `lettura_fallita: ${messaggio}` };
  }
}

/**
 * Invio di prova a un solo indirizzo.
 *
 * Usa `send()` e non una campagna: è sincrono, arriva subito e soprattutto
 * **non consuma il `ref`**, quindi si può ripetere quante volte serve prima
 * dell'invio reale.
 */
export async function prova(
  mail: MailMinima | null,
  edizione: Edizione,
  indirizzo: string,
): Promise<EsitoCampagna<{ id: string }>> {
  if (!mail) return { ok: false, errore: "mail_non_disponibile" };
  const a = indirizzo.trim();
  if (!a) return { ok: false, errore: "indirizzo_non_valido" };
  try {
    const { id } = await mail.send({
      to: a,
      subject: `[PROVA] ${edizione.oggetto}`,
      text: edizione.testo,
      html: edizione.html,
    });
    return { ok: true, dato: { id } };
  } catch (e) {
    const messaggio = e instanceof Error ? e.message : String(e);
    return { ok: false, errore: `prova_fallita: ${messaggio}` };
  }
}

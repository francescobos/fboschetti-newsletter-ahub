// Piano di lavoro — Dati di progetto
//
// FORMATO RIGA:
// fase | task | inizio | fine | chi | stato (opzionale: fatto)
//
// REGOLE:
// - Date in formato AAAA-MM-GG obbligatorio.
// - Per un task di un solo giorno: inizio = fine.
// - Stato opzionale: indicare 'fatto' (oppure prefisso '✓' nel nome del task).
// - Righe vuote e righe che iniziano con '#' sono ignorate.
// - L'ordine delle righe nel file determina l'ordine di stampa nella tabella.
// - Le fasi assumono un colore automatico dalla palette alla loro prima comparsa.
// - Raggruppa i task della stessa fase consecutivamente per avere l'intestazione pulita.
//
// DOPO UNA MODIFICA:
// Salva questo file, ricarica piano.html nel browser (Cmd+R), stampa o esporta in PDF (Cmd+P).

// Titolo visualizzato nella scheda del browser e nell'intestazione della pagina
const TITOLO_PIANO = "Plugin Newsletter — Cronoprogramma Roadmap";

const PIANO = `
# ---------- Fase 1 — Lista contatti ----------
Fase 1: Contatti | Schema contatto e migrazione SQLite | 2026-09-12 | 2026-09-12 | Francesco | fatto
Fase 1: Contatti | Import CSV idempotente su indirizzo | 2026-09-12 | 2026-09-12 | Francesco | fatto
Fase 1: Contatti | CRUD, stato tecnico e logica disiscrizione | 2026-09-13 | 2026-09-13 | Francesco | fatto
Fase 1: Contatti | UI pagina plugin con tabella e filtri | 2026-09-13 | 2026-09-13 | Francesco | fatto

# ---------- Fase 2 — Ingestione e validazione tecnica ----------
Fase 2: Tech | Schema edizione e macchina a stati | 2026-09-14 | 2026-09-17 | Francesco
Fase 2: Tech | Ingestione coppia .txt + .html e metadati | 2026-09-18 | 2026-09-22 | Francesco
Fase 2: Tech | Validatore deterministico strutturale | 2026-09-23 | 2026-09-28 | Francesco
Fase 2: Tech | UI anteprima proiezioni e report validazione | 2026-09-29 | 2026-10-02 | Francesco

# ---------- Fase 3 — Validazione semantica con LM Studio ----------
Fase 3: Semantica | Prompting confronto semantico e parser verdetto | 2026-10-05 | 2026-10-08 | Francesco
Fase 3: Semantica | Gestione LM Studio offline e blocco invio | 2026-10-09 | 2026-10-13 | Francesco
Fase 3: Semantica | Meccanismo di forzatura auditata e suite test | 2026-10-14 | 2026-10-16 | Francesco

# ---------- Fase 4 — Invio ----------
Fase 4: Invio | Risoluzione congelata destinatari e calcolo ref | 2026-10-19 | 2026-10-22 | Francesco
Fase 4: Invio | Invio di prova verso indirizzo admin | 2026-10-23 | 2026-10-26 | Francesco
Fase 4: Invio | Accodamento campagna via route (deps.mail) | 2026-10-27 | 2026-10-30 | Francesco
Fase 4: Invio | Rispecchiamento stato dal core (getCampaign) | 2026-11-02 | 2026-11-04 | Francesco

# ---------- Fase 5 — Cura e osservabilità ----------
Fase 5: Cura | Storico edizioni inviate e tracking destinatari | 2026-11-05 | 2026-11-10 | Francesco
Fase 5: Cura | Job schedulabile sincronizzazione campagne in corso | 2026-11-11 | 2026-11-13 | Francesco
Fase 5: Cura | Gestione rimbalzi/errori e rifinitura finale | 2026-11-16 | 2026-11-19 | Francesco

# ---------- Fase 6 — Comunicazione e Outreach ----------
Fase 6: Outreach | Definizione piano e calendario editoriale | 2026-11-20 | 2026-11-24 | Francesco
Fase 6: Outreach | Articolo cardine: architettura Agentic Hub e plugin | 2026-11-25 | 2026-11-28 | Francesco
Fase 6: Outreach | Post 1: Separazione ruoli (authoring vs trasporto) | 2026-11-30 | 2026-12-02 | Francesco
Fase 6: Outreach | Post 2: Validazione semantica locale con LM Studio | 2026-12-07 | 2026-12-09 | Francesco
Fase 6: Outreach | Post 3: Apertura outreach oltre i villaggi (B2B/PMI) | 2026-12-14 | 2026-12-17 | Francesco
Fase 6: Outreach | Post 4: Metriche reali e servizio newsletter-as-a-service | 2026-12-21 | 2026-12-24 | Francesco
`;

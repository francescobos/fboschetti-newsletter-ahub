// Piano di lavoro — Dati di progetto
//
// FORMATO RIGA:
// fase | task | inizio | fine | chi
//
// REGOLE:
// - Date in formato AAAA-MM-GG obbligatorio.
// - Per un task di un solo giorno: inizio = fine.
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
Fase 1: Contatti | Schema contatto e migrazione SQLite | 2026-09-14 | 2026-09-17 | Francesco
Fase 1: Contatti | Import CSV idempotente su indirizzo | 2026-09-18 | 2026-09-22 | Francesco
Fase 1: Contatti | CRUD, stato tecnico e logica disiscrizione | 2026-09-23 | 2026-09-26 | Francesco
Fase 1: Contatti | UI pagina plugin con tabella e filtri | 2026-09-28 | 2026-10-02 | Francesco

# ---------- Fase 2 — Ingestione e validazione tecnica ----------
Fase 2: Tech | Schema edizione e macchina a stati | 2026-10-05 | 2026-10-08 | Francesco
Fase 2: Tech | Ingestione coppia .txt + .html e metadati | 2026-10-09 | 2026-10-13 | Francesco
Fase 2: Tech | Validatore deterministico strutturale | 2026-10-14 | 2026-10-19 | Francesco
Fase 2: Tech | UI anteprima proiezioni e report validazione | 2026-10-20 | 2026-10-23 | Francesco

# ---------- Fase 3 — Validazione semantica con LM Studio ----------
Fase 3: Semantica | Prompting confronto semantico e parser verdetto | 2026-10-26 | 2026-10-29 | Francesco
Fase 3: Semantica | Gestione LM Studio offline e blocco invio | 2026-10-30 | 2026-11-03 | Francesco
Fase 3: Semantica | Meccanismo di forzatura auditata e suite test | 2026-11-04 | 2026-11-06 | Francesco

# ---------- Fase 4 — Invio ----------
Fase 4: Invio | Risoluzione congelata destinatari e calcolo ref | 2026-11-09 | 2026-11-12 | Francesco
Fase 4: Invio | Invio di prova verso indirizzo admin | 2026-11-13 | 2026-11-16 | Francesco
Fase 4: Invio | Accodamento campagna via route (deps.mail) | 2026-11-17 | 2026-11-20 | Francesco
Fase 4: Invio | Rispecchiamento stato dal core (getCampaign) | 2026-11-23 | 2026-11-25 | Francesco

# ---------- Fase 5 — Cura e osservabilità ----------
Fase 5: Cura | Storico edizioni inviate e tracking destinatari | 2026-11-26 | 2026-12-01 | Francesco
Fase 5: Cura | Job schedulabile sincronizzazione campagne in corso | 2026-12-02 | 2026-12-04 | Francesco
Fase 5: Cura | Gestione rimbalzi/errori e rifinitura finale | 2026-12-07 | 2026-12-10 | Francesco

# ---------- Fase 6 — Comunicazione e Outreach ----------
Fase 6: Outreach | Definizione piano e calendario editoriale | 2026-12-11 | 2026-12-15 | Francesco
Fase 6: Outreach | Articolo cardine: architettura Agentic Hub e plugin | 2026-12-16 | 2026-12-19 | Francesco
Fase 6: Outreach | Post 1: Separazione ruoli (authoring vs trasporto) | 2026-12-21 | 2026-12-23 | Francesco
Fase 6: Outreach | Post 2: Validazione semantica locale con LM Studio | 2026-12-28 | 2026-12-30 | Francesco
Fase 6: Outreach | Post 3: Apertura outreach oltre i villaggi (B2B/PMI) | 2027-01-04 | 2027-01-07 | Francesco
Fase 6: Outreach | Post 4: Metriche reali e servizio newsletter-as-a-service | 2027-01-11 | 2027-01-14 | Francesco
`;

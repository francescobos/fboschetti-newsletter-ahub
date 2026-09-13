import { useEffect, useRef, useState } from "react";
import { Header } from "@/components/layout/header";
import { Main } from "@/components/layout/main";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const meta = {
  title: "Contatti",
  icon: "mail",
  sidebar: true,
  order: 100,
};

const API = "/api/plugins/fboschetti-newsletter";

type Contatto = {
  id: number;
  email: string;
  nome: string | null;
  cognome: string | null;
  aziendaNome: string | null;
  ruolo: string | null;
  comune: string | null;
  provincia: string | null;
  iscritto: boolean;
  statoTecnico: string;
  disiscrittoVia: string | null;
  tag: string[];
};

type Rapporto = {
  righeLette: number;
  creati: number;
  aggiornati: number;
  disiscrittiIntatti: number;
  aziendeCreate: number;
};

export default function PaginaContatti() {
  const [righe, setRighe] = useState<Contatto[]>([]);
  const [totale, setTotale] = useState(0);
  const [testo, setTesto] = useState("");
  const [iscritto, setIscritto] = useState<string>("all");
  const [tag, setTag] = useState<string>("all");
  const [tagDisponibili, setTagDisponibili] = useState<string[]>([]);
  const [anteprima, setAnteprima] = useState<Rapporto | null>(null);
  const [fileScelto, setFileScelto] = useState<File | null>(null);
  const [dialogImportAperto, setDialogImportAperto] = useState(false);
  const [contattoDaDisiscrivere, setContattoDaDisiscrivere] = useState<Contatto | null>(null);
  const [canaleDisiscrizione, setCanaleDisiscrizione] = useState<string>("manuale");
  const [errore, setErrore] = useState<string | null>(null);
  const [caricamento, setCaricamento] = useState(false);
  const [importInCorso, setImportInCorso] = useState(false);

  // Stati per Form unificato (Nuovo Contatto / Modifica)
  const [dialogFormAperto, setDialogFormAperto] = useState(false);
  const [contattoInModifica, setContattoInModifica] = useState<Contatto | null>(null);
  const [formEmail, setFormEmail] = useState("");
  const [formNome, setFormNome] = useState("");
  const [formCognome, setFormCognome] = useState("");
  const [formAziendaNome, setFormAziendaNome] = useState("");
  const [formRuolo, setFormRuolo] = useState("");
  const [formComune, setFormComune] = useState("");
  const [formProvincia, setFormProvincia] = useState("");
  const [formTag, setFormTag] = useState("");
  const [formErrore, setFormErrore] = useState<string | null>(null);
  const [salvataggioInCorso, setSalvataggioInCorso] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  async function carica() {
    setCaricamento(true);
    const q = new URLSearchParams();
    if (testo) q.set("testo", testo);
    if (iscritto && iscritto !== "all") q.set("iscritto", iscritto);
    if (tag && tag !== "all") q.set("tag", tag);
    try {
      const res = await fetch(`${API}/contatti?${q}`);
      const dati = (await res.json()) as { righe: Contatto[]; totale: number };
      setRighe(dati.righe ?? []);
      setTotale(dati.totale ?? 0);
    } catch {
      setRighe([]);
    } finally {
      setCaricamento(false);
    }
  }

  async function caricaTag() {
    try {
      const r = await fetch(`${API}/tag`);
      const d = (await r.json()) as { righe: { nome: string }[] };
      setTagDisponibili(d.righe.map((t) => t.nome));
    } catch {
      setTagDisponibili([]);
    }
  }

  useEffect(() => {
    void carica();
    void caricaTag();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testo, iscritto, tag]);

  async function inviaFile(file: File, dryRun: boolean) {
    setErrore(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API}/import?dry_run=${dryRun ? "1" : "0"}`, {
      method: "POST",
      body: form,
    });
    const dati = (await res.json()) as { rapporto?: Rapporto; errore?: string };
    if (!res.ok || dati.errore) {
      setErrore(dati.errore ?? "Import fallito.");
      setAnteprima(null);
      return null;
    }
    return dati.rapporto ?? null;
  }

  async function scegliFile(file: File) {
    setFileScelto(file);
    setDialogImportAperto(true);
    const rap = await inviaFile(file, true);
    setAnteprima(rap);
  }

  async function confermaImport() {
    if (!fileScelto) return;
    setImportInCorso(true);
    await inviaFile(fileScelto, false);
    setImportInCorso(false);
    chiudiDialogImport();
    await carica();
    await caricaTag();
  }

  function chiudiDialogImport() {
    setDialogImportAperto(false);
    setAnteprima(null);
    setFileScelto(null);
    setErrore(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function azione(id: number, percorso: string, corpo?: unknown) {
    await fetch(`${API}/contatti/${id}/${percorso}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo ?? {}),
    });
    await carica();
  }

  async function confermaDisiscrizione() {
    if (!contattoDaDisiscrivere) return;
    await azione(contattoDaDisiscrivere.id, "disiscrivi", { via: canaleDisiscrizione });
    setContattoDaDisiscrivere(null);
    setCanaleDisiscrizione("manuale");
  }

  // Azioni form Crea / Modifica
  function apriNuovo() {
    setContattoInModifica(null);
    setFormEmail("");
    setFormNome("");
    setFormCognome("");
    setFormAziendaNome("");
    setFormRuolo("");
    setFormComune("");
    setFormProvincia("");
    setFormTag("");
    setFormErrore(null);
    setDialogFormAperto(true);
  }

  function apriModifica(c: Contatto) {
    setContattoInModifica(c);
    setFormEmail(c.email);
    setFormNome(c.nome ?? "");
    setFormCognome(c.cognome ?? "");
    setFormAziendaNome(c.aziendaNome ?? "");
    setFormRuolo(c.ruolo ?? "");
    setFormComune(c.comune ?? "");
    setFormProvincia(c.provincia ?? "");
    setFormTag(c.tag.join(", "));
    setFormErrore(null);
    setDialogFormAperto(true);
  }

  function chiudiDialogForm() {
    setDialogFormAperto(false);
    setContattoInModifica(null);
    setFormErrore(null);
  }

  function aggiungiTagAlForm(nomeTag: string) {
    const lista = formTag
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (!lista.some((t) => t.toLowerCase() === nomeTag.toLowerCase())) {
      lista.push(nomeTag);
      setFormTag(lista.join(", "));
    }
  }

  async function salvaContatto(e: React.FormEvent) {
    e.preventDefault();
    setFormErrore(null);

    const emailTrim = formEmail.trim();
    if (!emailTrim) {
      setFormErrore("L'email è obbligatoria.");
      return;
    }

    const tagArray = formTag
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    const payload = {
      email: emailTrim,
      nome: formNome.trim() || null,
      cognome: formCognome.trim() || null,
      aziendaNome: formAziendaNome.trim() || null,
      ruolo: formRuolo.trim() || null,
      comune: formComune.trim() || null,
      provincia: formProvincia.trim() || null,
      tag: tagArray,
    };

    setSalvataggioInCorso(true);
    try {
      const url = contattoInModifica
        ? `${API}/contatti/${contattoInModifica.id}`
        : `${API}/contatti`;
      const metodo = contattoInModifica ? "PATCH" : "POST";

      const res = await fetch(url, {
        method: metodo,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const dati = (await res.json()) as { id?: number; errore?: string; ok?: boolean };

      if (res.status === 409 || dati.errore === "email_gia_presente") {
        setFormErrore("Questa email è già associata a un altro contatto.");
        return;
      }

      if (!res.ok || dati.errore) {
        setFormErrore(
          dati.errore === "email_non_valida"
            ? "Formato email non valido."
            : dati.errore ?? "Errore durante il salvataggio.",
        );
        return;
      }

      chiudiDialogForm();
      await carica();
      await caricaTag();
    } catch {
      setFormErrore("Errore di connessione durante il salvataggio.");
    } finally {
      setSalvataggioInCorso(false);
    }
  }

  return (
    <>
      <Header>
        <div className="flex w-full items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Contatti</h1>
            <p className="text-sm text-muted-foreground">
              {totale} contatti in anagrafica
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={apriNuovo}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mr-1.5"
              >
                <path d="M5 12h14" />
                <path d="M12 5v14" />
              </svg>
              Nuovo contatto
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void scegliFile(f);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              Importa CSV
            </Button>
          </div>
        </div>
      </Header>

      <Main className="p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            className="w-full sm:w-72"
            placeholder="Cerca per email, nome, azienda…"
            value={testo}
            onChange={(e) => setTesto(e.target.value)}
          />

          <Select value={iscritto} onValueChange={setIscritto}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="Tutti gli stati" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti gli stati</SelectItem>
              <SelectItem value="true">Iscritti</SelectItem>
              <SelectItem value="false">Disiscritti</SelectItem>
            </SelectContent>
          </Select>

          <Select value={tag} onValueChange={setTag}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Tutti i tag" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i tag</SelectItem>
              {tagDisponibili.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-md border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[230px]">Email</TableHead>
                <TableHead className="w-[170px]">Nome</TableHead>
                <TableHead className="w-[190px]">Azienda</TableHead>
                <TableHead className="w-[150px]">Zona</TableHead>
                <TableHead>Tag</TableHead>
                <TableHead className="w-[170px]">Stato</TableHead>
                <TableHead className="w-[180px] text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {righe.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium max-w-[230px] truncate" title={c.email}>
                    {c.email}
                  </TableCell>
                  <TableCell className="max-w-[170px] truncate">
                    {[c.nome, c.cognome].filter(Boolean).join(" ") || "—"}
                  </TableCell>
                  <TableCell className="max-w-[190px] truncate">
                    {c.aziendaNome ? (
                      <span>
                        {c.aziendaNome}
                        {c.ruolo && (
                          <span className="text-muted-foreground text-xs block truncate">
                            {c.ruolo}
                          </span>
                        )}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="max-w-[150px] truncate">
                    {c.comune ? (
                      <span>
                        {c.comune}
                        {c.provincia && (
                          <span className="text-muted-foreground"> ({c.provincia})</span>
                        )}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {c.tag.length > 0 ? (
                        c.tag.map((t) => (
                          <Badge key={t} variant="secondary" className="text-xs">
                            {t}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {c.iscritto ? (
                        <Badge variant="outline" className="w-fit text-xs font-normal">
                          iscritto
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="w-fit text-xs font-normal">
                          disiscritto{c.disiscrittoVia ? ` (${c.disiscrittoVia})` : ""}
                        </Badge>
                      )}
                      {c.statoTecnico !== "mai_verificato" && (
                        <span className="text-muted-foreground text-xs">
                          {c.statoTecnico}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        onClick={() => apriModifica(c)}
                        title="Modifica contatto"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="mr-1 opacity-70"
                        >
                          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                          <path d="m15 5 4 4" />
                        </svg>
                        Modifica
                      </Button>
                      {c.iscritto ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-2 text-xs"
                          onClick={() => {
                            setCanaleDisiscrizione("manuale");
                            setContattoDaDisiscrivere(c);
                          }}
                        >
                          Disiscrivi
                        </Button>
                      ) : (
                        <Button
                          variant="default"
                          size="sm"
                          className="h-8 px-2 text-xs"
                          onClick={() => void azione(c.id, "riscrivi")}
                        >
                          Riscrivi
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}

              {righe.length === 0 && !caricamento && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="h-32 text-center text-muted-foreground"
                  >
                    Nessun contatto trovato. Inserisci un nuovo contatto o importa un file CSV.
                  </TableCell>
                </TableRow>
              )}

              {caricamento && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="h-32 text-center text-muted-foreground"
                  >
                    Caricamento contatti…
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Main>

      {/* Dialog Unificato per Nuovo Contatto / Modifica */}
      <Dialog
        open={dialogFormAperto}
        onOpenChange={(aperto) => {
          if (!aperto) chiudiDialogForm();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {contattoInModifica ? "Modifica contatto" : "Nuovo contatto"}
            </DialogTitle>
            <DialogDescription>
              {contattoInModifica
                ? "Aggiorna le informazioni anagrafiche e i tag del contatto."
                : "Inserisci i dati per registrare un nuovo contatto in anagrafica."}
            </DialogDescription>
          </DialogHeader>

          {contattoInModifica && (
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Stato iscrizione:</span>
                {contattoInModifica.iscritto ? (
                  <Badge variant="outline" className="text-xs font-normal">
                    iscritto
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="text-xs font-normal">
                    disiscritto{contattoInModifica.disiscrittoVia ? ` (${contattoInModifica.disiscrittoVia})` : ""}
                  </Badge>
                )}
              </div>
              {contattoInModifica.statoTecnico !== "mai_verificato" && (
                <span className="text-muted-foreground">
                  Stato: <span className="text-foreground font-medium">{contattoInModifica.statoTecnico}</span>
                </span>
              )}
            </div>
          )}

          {formErrore && (
            <Alert variant="destructive">
              <AlertTitle>Errore</AlertTitle>
              <AlertDescription>{formErrore}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={salvaContatto} className="space-y-3 py-1">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Email *</label>
              <Input
                type="email"
                placeholder="es. mario.rossi@azienda.it"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Nome</label>
                <Input
                  placeholder="Nome"
                  value={formNome}
                  onChange={(e) => setFormNome(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Cognome</label>
                <Input
                  placeholder="Cognome"
                  value={formCognome}
                  onChange={(e) => setFormCognome(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Azienda</label>
                <Input
                  placeholder="Ragione sociale"
                  value={formAziendaNome}
                  onChange={(e) => setFormAziendaNome(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Ruolo</label>
                <Input
                  placeholder="es. CTO, Responsabile Vendite"
                  value={formRuolo}
                  onChange={(e) => setFormRuolo(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Comune</label>
                <Input
                  placeholder="es. Milano"
                  value={formComune}
                  onChange={(e) => setFormComune(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Provincia (sigla)</label>
                <Input
                  placeholder="es. MI"
                  maxLength={5}
                  value={formProvincia}
                  onChange={(e) => setFormProvincia(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium">Tag (separati da virgola)</label>
                {tagDisponibili.length > 0 && (
                  <span className="text-muted-foreground text-xs">clicca per aggiungere</span>
                )}
              </div>
              <Input
                placeholder="es. partner, vip, eventi"
                value={formTag}
                onChange={(e) => setFormTag(e.target.value)}
              />
              {tagDisponibili.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {tagDisponibili.map((t) => {
                    const tagsPresenti = formTag
                      .split(",")
                      .map((x) => x.trim().toLowerCase())
                      .filter(Boolean);
                    const giaAggiunto = tagsPresenti.includes(t.toLowerCase());
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => aggiungiTagAlForm(t)}
                        className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                          giaAggiunto
                            ? "bg-primary text-primary-foreground border-primary cursor-default"
                            : "bg-muted text-muted-foreground border-border hover:bg-muted/80 cursor-pointer"
                        }`}
                      >
                        +{t}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={chiudiDialogForm}
                disabled={salvataggioInCorso}
              >
                Annulla
              </Button>
              <Button
                type="submit"
                variant="default"
                size="sm"
                disabled={salvataggioInCorso}
              >
                {salvataggioInCorso
                  ? "Salvataggio…"
                  : contattoInModifica
                    ? "Salva modifiche"
                    : "Crea contatto"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog per Disiscrizione */}
      <Dialog
        open={Boolean(contattoDaDisiscrivere)}
        onOpenChange={(aperto) => {
          if (!aperto) setContattoDaDisiscrivere(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disiscrivi contatto</DialogTitle>
            <DialogDescription>
              Stai per disiscrivere{" "}
              <span className="font-semibold text-foreground">
                {contattoDaDisiscrivere?.email}
              </span>
              . Seleziona il canale attraverso cui è pervenuta la richiesta.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-2">
            <label className="text-sm font-medium">Canale di disiscrizione</label>
            <Select
              value={canaleDisiscrizione}
              onValueChange={setCanaleDisiscrizione}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleziona canale" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manuale">Manuale</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="telefono">Telefono</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setContattoDaDisiscrivere(null)}
            >
              Annulla
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void confermaDisiscrizione()}
            >
              Conferma disiscrizione
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog per Import CSV */}
      <Dialog
        open={dialogImportAperto}
        onOpenChange={(aperto) => {
          if (!aperto) chiudiDialogImport();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Importazione Contatti CSV</DialogTitle>
            <DialogDescription>
              {fileScelto ? fileScelto.name : "Carica un file CSV di contatti"}
            </DialogDescription>
          </DialogHeader>

          {errore && (
            <Alert variant="destructive">
              <AlertTitle>Errore importazione</AlertTitle>
              <AlertDescription>{errore}</AlertDescription>
            </Alert>
          )}

          {anteprima && !errore && (
            <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4 text-sm">
              <p className="font-medium text-foreground">Rapporto anteprima (dry-run):</p>
              <ul className="space-y-1 text-muted-foreground text-sm">
                <li>• {anteprima.righeLette} righe lette</li>
                <li>• {anteprima.creati} contatti nuovi da creare</li>
                <li>• {anteprima.aggiornati} contatti esistenti da aggiornare</li>
                <li>• {anteprima.disiscrittiIntatti} contatti disiscritti che rimarranno tali</li>
                <li>• {anteprima.aziendeCreate} nuove aziende censite</li>
              </ul>
            </div>
          )}

          {!anteprima && !errore && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Analisi del file in corso…
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={chiudiDialogImport}
              disabled={importInCorso}
            >
              Annulla
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={!anteprima || Boolean(errore) || importInCorso}
              onClick={() => void confermaImport()}
            >
              {importInCorso ? "Importazione in corso…" : "Conferma import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

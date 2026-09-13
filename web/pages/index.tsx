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

  useEffect(() => {
    void carica();
    void fetch(`${API}/tag`)
      .then((r) => r.json() as Promise<{ righe: { nome: string }[] }>)
      .then((d) => setTagDisponibili(d.righe.map((t) => t.nome)))
      .catch(() => setTagDisponibili([]));
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
          <div>
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
              variant="default"
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
                <TableHead className="w-[240px]">Email</TableHead>
                <TableHead className="w-[180px]">Nome</TableHead>
                <TableHead className="w-[200px]">Azienda</TableHead>
                <TableHead className="w-[160px]">Zona</TableHead>
                <TableHead>Tag</TableHead>
                <TableHead className="w-[180px]">Stato</TableHead>
                <TableHead className="w-[120px] text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {righe.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium max-w-[240px] truncate" title={c.email}>
                    {c.email}
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate">
                    {[c.nome, c.cognome].filter(Boolean).join(" ") || "—"}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">
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
                  <TableCell className="max-w-[160px] truncate">
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
                    {c.iscritto ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
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
                        className="text-xs"
                        onClick={() => void azione(c.id, "riscrivi")}
                      >
                        Riscrivi
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}

              {righe.length === 0 && !caricamento && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="h-32 text-center text-muted-foreground"
                  >
                    Nessun contatto trovato. Importa un file CSV per cominciare.
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

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { Main } from "@/components/layout/main";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const meta = {
  title: "Edizioni",
  icon: "rocket",
  sidebar: true,
  order: 110,
};

const API = "/api/plugins/fboschetti-newsletter";

type Stato = "bozza" | "pronta" | "in_invio" | "inviata";

type Edizione = {
  id: number;
  ref: string;
  oggetto: string;
  stato: Stato;
  campagnaId: string | null;
  avvisoMailto: string | null;
  filtroTag: string | null;
  destinatariN: number | null;
  creatoIl: number;
};

type StatoCampagna = {
  status: string;
  total: number;
  sentCount: number;
  errorCount: number;
};

const ETICHETTA: Record<Stato, string> = {
  bozza: "Bozza",
  pronta: "Accodata",
  in_invio: "In invio",
  inviata: "Inviata",
};

export default function PaginaEdizioni() {
  const [righe, setRighe] = useState<Edizione[]>([]);
  const [percorso, setPercorso] = useState("");
  const [ref, setRef] = useState("");
  const [oggetto, setOggetto] = useState("");
  const [indirizzoProva, setIndirizzoProva] = useState("");
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [stati, setStati] = useState<Record<number, StatoCampagna>>({});

  async function carica() {
    const res = await fetch(`${API}/edizioni`);
    const corpo = await res.json();
    setRighe(corpo.righe ?? []);
  }

  useEffect(() => {
    void carica();
  }, []);

  /** Centralizza l'esito: ogni azione o dice cosa ha fatto, o perché no. */
  async function agisci(
    url: string,
    opzioni: RequestInit,
    successo: (corpo: Record<string, unknown>) => string,
  ) {
    setMessaggio(null);
    setErrore(null);
    const res = await fetch(url, opzioni);
    const corpo = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrore(String(corpo.errore ?? `errore ${res.status}`));
      return false;
    }
    setMessaggio(successo(corpo));
    await carica();
    return true;
  }

  async function ingesta(e: React.FormEvent) {
    e.preventDefault();
    await agisci(
      `${API}/edizioni`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ percorso, ref, oggetto }),
      },
      (corpo) =>
        `Edizione creata con ref "${corpo.ref}".` +
        (corpo.avvisoMailto ? ` Attenzione: ${corpo.avvisoMailto}` : ""),
    );
  }

  async function anteprima(id: number) {
    setMessaggio(null);
    setErrore(null);
    const res = await fetch(`${API}/edizioni/${id}/destinatari`);
    const corpo = await res.json();
    setMessaggio(`${corpo.totale} destinatari risolti.`);
  }

  async function mandaProva(id: number) {
    if (!indirizzoProva.trim()) {
      setErrore("Indica un indirizzo per la prova.");
      return;
    }
    await agisci(
      `${API}/edizioni/${id}/prova`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ a: indirizzoProva }),
      },
      () => `Prova inviata a ${indirizzoProva}.`,
    );
  }

  async function accoda(id: number) {
    await agisci(
      `${API}/edizioni/${id}/accoda`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
      (corpo) =>
        `Campagna accodata per ${corpo.destinatari} destinatari. ` +
        `Nessuna mail è ancora partita: serve avviarla.`,
    );
  }

  async function avvia(id: number) {
    await agisci(`${API}/edizioni/${id}/avvia`, { method: "POST" }, () =>
      "Campagna avviata: il core la sta drenando.",
    );
  }

  async function aggiornaStato(id: number) {
    const res = await fetch(`${API}/edizioni/${id}/stato`);
    const corpo = await res.json();
    if (!res.ok) {
      setErrore(String(corpo.errore ?? `errore ${res.status}`));
      return;
    }
    setStati((s) => ({ ...s, [id]: corpo as StatoCampagna }));
    await carica();
  }

  return (
    <>
      <Header />
      <Main>
        <div className="space-y-4 p-4">
          <div>
            <h1 className="text-2xl font-semibold">Edizioni</h1>
            <p className="text-muted-foreground text-sm">
              Importa una coppia .txt + .html e mandala ai contatti iscritti.
            </p>
          </div>

          {messaggio && (
            <Alert>
              <AlertTitle>Fatto</AlertTitle>
              <AlertDescription>{messaggio}</AlertDescription>
            </Alert>
          )}
          {errore && (
            <Alert variant="destructive">
              <AlertTitle>Non è andata</AlertTitle>
              <AlertDescription>{errore}</AlertDescription>
            </Alert>
          )}

          <Card className="p-4">
            <form onSubmit={ingesta} className="space-y-3">
              <h2 className="font-medium">Nuova edizione</h2>
              <Input
                placeholder="Percorso della cartella o di uno dei due file"
                value={percorso}
                onChange={(e) => setPercorso(e.target.value)}
              />
              <Input
                placeholder="Oggetto della mail"
                value={oggetto}
                onChange={(e) => setOggetto(e.target.value)}
              />
              <Input
                placeholder="Riferimento, es. newsletter-2026-09"
                value={ref}
                onChange={(e) => setRef(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Il riferimento viene normalizzato in minuscole e trattini, e
                protegge dal doppio invio: non può essere riusato.
              </p>
              <Button type="submit">Importa</Button>
            </form>
          </Card>

          <Card className="p-4">
            <div className="space-y-3">
              <h2 className="font-medium">Invio di prova</h2>
              <Input
                placeholder="Il tuo indirizzo, per la prova"
                value={indirizzoProva}
                onChange={(e) => setIndirizzoProva(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                La prova non consuma il riferimento: si può ripetere.
              </p>
            </div>
          </Card>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Riferimento</TableHead>
                  <TableHead>Oggetto</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>Destinatari</TableHead>
                  <TableHead>Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {righe.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="max-w-[16rem] truncate font-mono text-xs">
                      {e.ref}
                    </TableCell>
                    <TableCell className="max-w-[20rem] truncate">
                      {e.oggetto}
                      {e.avvisoMailto && (
                        <span className="text-muted-foreground block text-xs">
                          {e.avvisoMailto}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{ETICHETTA[e.stato]}</Badge>
                    </TableCell>
                    <TableCell>
                      {stati[e.id]
                        ? `${stati[e.id]!.sentCount}/${stati[e.id]!.total}`
                        : (e.destinatariN ?? "—")}
                    </TableCell>
                    <TableCell className="space-x-2">
                      {e.stato === "bozza" && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => anteprima(e.id)}
                          >
                            Destinatari
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => mandaProva(e.id)}
                          >
                            Prova
                          </Button>
                          <Button size="sm" onClick={() => accoda(e.id)}>
                            Accoda
                          </Button>
                        </>
                      )}
                      {e.stato === "pronta" && (
                        <Button size="sm" onClick={() => avvia(e.id)}>
                          Avvia invio
                        </Button>
                      )}
                      {(e.stato === "in_invio" || e.stato === "inviata") && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => aggiornaStato(e.id)}
                        >
                          Aggiorna stato
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {righe.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-muted-foreground py-6 text-center"
                    >
                      Nessuna edizione. Importane una qui sopra.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </Main>
    </>
  );
}

import { useEffect, useState } from "react";

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
  const [iscritto, setIscritto] = useState<string>("");
  const [tag, setTag] = useState("");
  const [tagDisponibili, setTagDisponibili] = useState<string[]>([]);
  const [anteprima, setAnteprima] = useState<Rapporto | null>(null);
  const [fileScelto, setFileScelto] = useState<File | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [caricamento, setCaricamento] = useState(false);

  async function carica() {
    setCaricamento(true);
    const q = new URLSearchParams();
    if (testo) q.set("testo", testo);
    if (iscritto) q.set("iscritto", iscritto);
    if (tag) q.set("tag", tag);
    const res = await fetch(`${API}/contatti?${q}`);
    const dati = (await res.json()) as { righe: Contatto[]; totale: number };
    setRighe(dati.righe);
    setTotale(dati.totale);
    setCaricamento(false);
  }

  useEffect(() => {
    void carica();
    void fetch(`${API}/tag`)
      .then((r) => r.json() as Promise<{ righe: { nome: string }[] }>)
      .then((d) => setTagDisponibili(d.righe.map((t) => t.nome)));
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
      setErrore(dati.errore ?? "import fallito");
      setAnteprima(null);
      return null;
    }
    return dati.rapporto ?? null;
  }

  async function scegliFile(file: File) {
    setFileScelto(file);
    setAnteprima(await inviaFile(file, true));
  }

  async function confermaImport() {
    if (!fileScelto) return;
    await inviaFile(fileScelto, false);
    setAnteprima(null);
    setFileScelto(null);
    await carica();
  }

  async function azione(id: number, percorso: string, corpo?: unknown) {
    await fetch(`${API}/contatti/${id}/${percorso}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo ?? {}),
    });
    await carica();
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Contatti</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {totale} contatti in anagrafica
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          className="border-border bg-background rounded border px-3 py-1.5 text-sm"
          placeholder="Cerca per email, nome, azienda…"
          value={testo}
          onChange={(e) => setTesto(e.target.value)}
        />
        <select
          className="border-border bg-background rounded border px-3 py-1.5 text-sm"
          value={iscritto}
          onChange={(e) => setIscritto(e.target.value)}
        >
          <option value="">Tutti</option>
          <option value="true">Iscritti</option>
          <option value="false">Disiscritti</option>
        </select>
        <select
          className="border-border bg-background rounded border px-3 py-1.5 text-sm"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
        >
          <option value="">Tutti i tag</option>
          {tagDisponibili.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className="border-border bg-muted/30 hover:bg-muted cursor-pointer rounded border px-3 py-1.5 text-sm">
          Importa CSV
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void scegliFile(f);
            }}
          />
        </label>
      </div>

      {errore && (
        <div className="border-border bg-muted/30 rounded border p-4 text-sm">
          <span className="font-medium">CSV rifiutato.</span> {errore}
        </div>
      )}

      {anteprima && (
        <div className="border-border bg-muted/30 space-y-3 rounded border p-4">
          <p className="text-sm font-medium">Anteprima dell'import</p>
          <ul className="text-muted-foreground space-y-1 text-sm">
            <li>{anteprima.righeLette} righe lette</li>
            <li>{anteprima.creati} contatti nuovi</li>
            <li>{anteprima.aggiornati} contatti aggiornati</li>
            <li>
              {anteprima.disiscrittiIntatti} disiscritti che resteranno tali
            </li>
            <li>{anteprima.aziendeCreate} aziende nuove</li>
          </ul>
          <div className="flex gap-2">
            <button
              className="bg-primary text-primary-foreground rounded px-3 py-1 text-xs font-medium hover:opacity-85"
              onClick={() => void confermaImport()}
            >
              Conferma import
            </button>
            <button
              className="border-border rounded border px-3 py-1 text-xs"
              onClick={() => {
                setAnteprima(null);
                setFileScelto(null);
              }}
            >
              Annulla
            </button>
          </div>
        </div>
      )}

      <div className="border-border overflow-x-auto rounded border">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr className="text-muted-foreground text-left">
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Nome</th>
              <th className="px-3 py-2 font-medium">Azienda</th>
              <th className="px-3 py-2 font-medium">Zona</th>
              <th className="px-3 py-2 font-medium">Tag</th>
              <th className="px-3 py-2 font-medium">Stato</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {righe.map((c) => (
              <tr key={c.id} className="border-border border-t">
                <td className="px-3 py-2">{c.email}</td>
                <td className="px-3 py-2">
                  {[c.nome, c.cognome].filter(Boolean).join(" ") || "—"}
                </td>
                <td className="px-3 py-2">
                  {c.aziendaNome ?? "—"}
                  {c.ruolo && (
                    <span className="text-muted-foreground"> · {c.ruolo}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {c.comune ?? "—"}
                  {c.provincia && (
                    <span className="text-muted-foreground"> ({c.provincia})</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {c.tag.map((t) => (
                      <span
                        key={t}
                        className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2">
                  {c.iscritto ? (
                    <span className="text-muted-foreground text-xs">iscritto</span>
                  ) : (
                    <span className="border-border rounded border px-1.5 py-0.5 text-xs font-medium">
                      disiscritto{c.disiscrittoVia ? ` · ${c.disiscrittoVia}` : ""}
                    </span>
                  )}
                  {c.statoTecnico !== "mai_verificato" && (
                    <span className="text-muted-foreground ml-1 text-xs">
                      · {c.statoTecnico}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {c.iscritto ? (
                    <button
                      className="border-border rounded border px-2 py-1 text-xs"
                      onClick={() => {
                        const via = window.prompt(
                          "Come si è disiscritto? telefono / email / manuale",
                          "manuale",
                        );
                        if (via) void azione(c.id, "disiscrivi", { via });
                      }}
                    >
                      Disiscrivi
                    </button>
                  ) : (
                    <button
                      className="bg-primary text-primary-foreground rounded px-2 py-1 text-xs font-medium hover:opacity-85"
                      onClick={() => void azione(c.id, "riscrivi")}
                    >
                      Riscrivi
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {righe.length === 0 && !caricamento && (
              <tr>
                <td
                  colSpan={7}
                  className="text-muted-foreground px-3 py-8 text-center"
                >
                  Nessun contatto. Importa un CSV per cominciare.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

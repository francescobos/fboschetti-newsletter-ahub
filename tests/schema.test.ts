import { expect, test } from "bun:test";
import { creaDbDiTest } from "./helpers";

test("lo schema si applica e le tabelle esistono", () => {
  const db = creaDbDiTest();
  const nomi = db
    .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  const trovate = nomi.map((r) => r.name);
  expect(trovate).toContain("contatti");
  expect(trovate).toContain("aziende");
  expect(trovate).toContain("tag");
  expect(trovate).toContain("contatti_tag");
  expect(trovate).toContain("import_csv");
  expect(trovate).not.toContain("righe");
});

test("le foreign key sono attive sulla connessione", () => {
  const db = creaDbDiTest();
  const r = db.query("PRAGMA foreign_keys").get() as { foreign_keys: number };
  expect(r.foreign_keys).toBe(1);
});

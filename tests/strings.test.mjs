// French (OPPORTUNITY-PLAN-APPS.md B7: "a check finds no string without a French translation"), and that the
// screens hold no words of their own: every key a screen asks for exists in both languages with the same {values},
// and no screen has text between its tags or in a placeholder or title that is not a key.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { STRINGS, formats, systemLanguage, translator } from "../src/lib/strings.js";
import { APP } from "./helpers.mjs";

const SCREENS = ["App.jsx", "Charts.jsx"].map((f) => [f, fs.readFileSync(path.join(APP, "src", f), "utf8")]);
const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("every string has a French translation, with the same values to fill", () => {
  const en = Object.keys(STRINGS.en).sort(), fr = Object.keys(STRINGS.fr).sort();
  assert.deepEqual(fr.filter((k) => !en.includes(k)), [], "French keys with no English");
  assert.deepEqual(en.filter((k) => !fr.includes(k)), [], "strings without a French translation");
  for (const k of en) {
    assert.deepEqual(vars(STRINGS.fr[k]), vars(STRINGS.en[k]), `${k}: the French fills different values`);
    assert.ok(STRINGS.fr[k].trim() && STRINGS.en[k].trim(), `${k} is empty`);
  }
  // a translation, not the English again (names and symbols aside)
  const same = en.filter((k) => STRINGS.fr[k] === STRINGS.en[k] && /[a-z]{4,}/i.test(STRINGS.en[k]));
  assert.deepEqual(same, ["acct.type", "app.name", "country.CA", "res.sortino"].filter((k) => same.includes(k)), `not translated: ${same}`);
});

test("every key a screen asks for is a string, and every string is asked for", () => {
  const used = new Set();
  for (const [name, src] of SCREENS) {
    for (const m of src.matchAll(/\bt\(\s*"([^"]+)"/g)) used.add(m[1]);
    // keys built from a value: t(`country.${c}`), t(x ? "a" : "b"), NAV's table, an Error's message
    for (const m of src.matchAll(/\bt\(\s*`([a-zA-Z.]+)\$\{/g)) for (const k of Object.keys(STRINGS.en)) if (k.startsWith(m[1])) used.add(k);
    for (const m of src.matchAll(/"((?:nav|data|check|import|hold|res|reg|opt|cat|book|core|margin|rebalance|builder|acct|pool|lang|app)\.[A-Za-z0-9_.]+)"/g)) used.add(m[1]);
    for (const k of used) assert.ok(k in STRINGS.en, `${name} asks for ${k}, which is not a string`);
  }
  for (const k of Object.keys(STRINGS.en).filter((k) => k.startsWith("import."))) used.add(k);     // book.js's errors
  const unused = Object.keys(STRINGS.en).filter((k) => !used.has(k));
  assert.deepEqual(unused, [], "strings no screen asks for");
});

test("no screen holds a sentence of its own", () => {
  for (const [name, src] of SCREENS) {
    const jsx = src.replace(/\/\/[^\n]*\n/g, "\n").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    // text between tags: >words< (expressions in braces are not text)
    const loose = [...jsx.matchAll(/>([^<>{}]*[A-Za-zÀ-ÿ]{3,}[^<>{}]*)</g)].map((m) => m[1].trim())
      .filter((s) => s && !/^[=!&|?:;,.()\[\]\s\w$]*=>/.test(s) && !/[;=]|\breturn\b|\bconst\b|&&|\|\||^\)|\? \($/.test(s));
    assert.deepEqual(loose, [], `${name} has text that is not a string key`);
    const attrs = [...jsx.matchAll(/\b(?:placeholder|title|alt|aria-label)="([^"]*[A-Za-z]{3,}[^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(attrs, [], `${name} has an attribute with words of its own`);
  }
});

test("a string is filled, falls back to English, and numbers follow the language", () => {
  assert.equal(translator("fr")("account.as", { email: "a@b.c", region: "Québec" }), "Connecté : a@b.c, Québec.");
  assert.equal(translator("xx")("nav.book"), "Portfolio");
  assert.throws(() => translator("en")("no.such.key"), /no string/);
  assert.equal(systemLanguage({ language: "fr-CA" }), "fr");
  assert.equal(systemLanguage({ language: "de-DE" }), "en");
  assert.equal(formats("en").pct(0.0834), "8.34%");
  assert.match(formats("fr").pct(0.0834), /^8,34\s%$/);
  assert.equal(formats("en").money(1234567.8), "1,234,568");
  assert.equal(formats("fr").pct(null), "–");
});

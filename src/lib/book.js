// A book as the app holds it: the user's accounts, the settings of the calculation, and what is held at what
// weight. It is exactly what the core takes (core/cupel_core/api.py), so a book exported from the app is a file the
// core reads, and nothing is translated between the screens and the calculation.
//
// A weight is a share of the capital (all the accounts together), as in cupel's own books. The screens show and
// take it as a percentage of its pool's money, which is what a person thinks in: `toPool` and `fromPool`.

export const FILE_KIND = "cupel-book";
export const FILE_VERSION = 1;

export function newBook(country = "CA") {
  return { name: "", country, accounts: [], buying_power: 0, collateral: [], margin: "off", rebalance: "M",
           years: 30, ruin: 0.05, inflation: 0.02, holdings: [] };
}

export const poolKey = (h) => `${h.sleeve}|${h.lever ? 1 : 0}`;

// a holding's weight as a share of its pool's money (pools: the core's `pools` answer)
export function toPool(h, pools) {
  const p = pools.pools.find((x) => x.sleeve === h.sleeve && x.lever === h.lever);
  return p ? h.weight / p.share : null;
}
export function fromPool(share, sleeve, lever, pools) {
  const p = pools.pools.find((x) => x.sleeve === sleeve && x.lever === lever);
  return p ? share * p.share : 0;
}

// each pool's total, as a share of its own money (1 = fully invested; above 1 = borrowing)
export function poolTotals(book, pools) {
  const out = {};
  for (const p of pools.pools) out[poolKey(p)] = 0;
  for (const h of book.holdings) if (poolKey(h) in out) out[poolKey(h)] += toPool(h, pools);
  return out;
}

export function setHolding(book, run, sleeve, lever, weight) {
  const rest = book.holdings.filter((h) => !(h.run === run && h.sleeve === sleeve && h.lever === lever));
  return { ...book, holdings: weight > 0 ? [...rest, { run, sleeve, lever, weight }] : rest };
}

export function removeRun(book, run) {
  return { ...book, holdings: book.holdings.filter((h) => h.run !== run) };
}

// holdings whose pool the accounts no longer form (an account was removed): dropped, and said
export function fitToPools(book, pools) {
  const keys = new Set(pools.pools.map(poolKey));
  const gone = book.holdings.filter((h) => !keys.has(poolKey(h)));
  return { book: gone.length ? { ...book, holdings: book.holdings.filter((h) => keys.has(poolKey(h))) } : book, gone };
}

// --- a book as a file: what the user exports, keeps, and may choose to give an adviser ---------------------------

export function exportBook(book, release) {
  return JSON.stringify({ kind: FILE_KIND, version: FILE_VERSION,
                          release: release ? { release_id: release.release_id, as_of: release.manifest.as_of } : null,
                          book }, null, 1);
}

// The book in a file, or an Error whose message is a key of the strings (src/lib/strings.js) saying what is wrong.
export function importBook(text) {
  let f;
  try { f = JSON.parse(text); } catch { throw new Error("import.notJson"); }
  if (!f || f.kind !== FILE_KIND) throw new Error("import.notBook");
  if (f.version !== FILE_VERSION) throw new Error("import.version");
  const b = f.book;
  const num = (x) => typeof x === "number" && Number.isFinite(x);
  const ok = b && typeof b === "object" && ["CA", "US"].includes(b.country) && Array.isArray(b.accounts) && Array.isArray(b.holdings)
    && b.accounts.every((a) => typeof a.name === "string" && typeof a.type === "string" && num(a.balance))
    && b.holdings.every((h) => Number.isInteger(h.run) && ["CAD", "USD"].includes(h.sleeve) && typeof h.lever === "boolean" && num(h.weight));
  if (!ok) throw new Error("import.shape");
  return { ...newBook(b.country), ...b };
}

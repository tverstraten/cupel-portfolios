// The book model and the API client (src/lib/book.js, src/lib/api.js): weights as a share of a pool's money and
// back, a book saved to a file and opened again, a file that is not one refused in words, and the API's answers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { exportBook, fitToPools, fromPool, importBook, newBook, poolTotals, setHolding, toPool } from "../src/lib/book.js";
import { STRINGS } from "../src/lib/strings.js";
import { EXPECTED } from "./helpers.mjs";

const BOOK = EXPECTED.self_check[0].book, POOLS = EXPECTED.pools;

test("a weight is shown as a share of its pool's money, and entered the same way", () => {
  const h = BOOK.holdings[0];                                  // 0.25 of the capital, in the CAD registered pool (35/58)
  assert.ok(Math.abs(toPool(h, POOLS) - 0.25 / (35 / 58)) < 1e-12);
  assert.ok(Math.abs(fromPool(toPool(h, POOLS), h.sleeve, h.lever, POOLS) - h.weight) < 1e-15);
  const totals = poolTotals(BOOK, POOLS);
  assert.ok(Math.abs(totals["CAD|0"] - 1) < 1e-12 && Math.abs(totals["USD|0"] - 1) < 1e-12);
  assert.ok(totals["CAD|1"] > 1);                              // the margin accounts borrow
});

test("a holding is set, replaced and removed; holdings of money that is gone are dropped and counted", () => {
  let b = setHolding(newBook(), 101, "CAD", false, 0.2);
  b = setHolding(b, 101, "CAD", false, 0.3);
  assert.deepEqual(b.holdings, [{ run: 101, sleeve: "CAD", lever: false, weight: 0.3 }]);
  assert.deepEqual(setHolding(b, 101, "CAD", false, 0).holdings, []);
  const noMargin = { ...POOLS, pools: POOLS.pools.filter((p) => !p.lever) };
  const fit = fitToPools(BOOK, noMargin);
  assert.equal(fit.gone.length, 2);
  assert.ok(fit.book.holdings.every((h) => !h.lever));
});

test("a book saved to a file opens again as the same book", () => {
  const text = exportBook(BOOK, { release_id: 1, manifest: { as_of: "2025-12-31" } });
  const file = JSON.parse(text);
  assert.equal(file.kind, "cupel-book");
  assert.deepEqual(file.release, { release_id: 1, as_of: "2025-12-31" });
  assert.deepEqual(importBook(text), { ...newBook("CA"), ...BOOK });
});

test("a file that is not a book is refused, with a message the app has in both languages", () => {
  const cases = [["not json at all", "import.notJson"], ['{"kind":"other"}', "import.notBook"],
                 ['{"kind":"cupel-book","version":2,"book":{}}', "import.version"],
                 ['{"kind":"cupel-book","version":1,"book":{"country":"CA","accounts":[{"name":"a"}],"holdings":[]}}', "import.shape"],
                 ['{"kind":"cupel-book","version":1,"book":{"country":"FR","accounts":[],"holdings":[]}}', "import.shape"]];
  for (const [text, key] of cases) {
    assert.throws(() => importBook(text), (e) => e.message === key, text);
    assert.ok(STRINGS.en[key] && STRINGS.fr[key]);
  }
});

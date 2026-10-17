// What a build of the app has switched on (OPPORTUNITY-PLAN-APPS.md B5, B6).
//
// The optimizer and "work with an adviser" are built and switched OFF in a release build, until counsel has
// answered for them (OPPORTUNITY.md, "The advice question"; TODO.md 11, 33). A release build is `vite build` with no
// flag set: there the two constants below are the literal `false`, the bundler drops the screens behind them, and
// app/tests/policy.test.mjs checks the built files hold neither. A development or test build sets the flag.
export const OPTIMIZER = import.meta.env.VITE_CUPEL_OPTIMIZER === "on";
export const REFERRAL = import.meta.env.VITE_CUPEL_REFERRAL === "on";

// cupel's API: the only place the app ever asks anything of (src/lib/api.js). Fixed when the app is built. Until the
// site has a public address (OPPORTUNITY-PLAN-GENERAL.md 2.3) it is the site on this machine.
export const API = import.meta.env.VITE_CUPEL_API || "http://127.0.0.1:8814";

// cupel's site as a person's browser reaches it: where the sign-in page is, and where Google signs them in (a
// browser's session is the host's, so this is the address the site itself gives its links: on this machine
// `localhost`, not 127.0.0.1). The app opens the sign-in page there and nowhere else (src/lib/api.js; the program's
// permissions). Once the site is hosted this and the API are one address.
export const SITE = import.meta.env.VITE_CUPEL_SITE || "http://localhost:8814";

// Whether the sign-in page is opened in the person's browser by the app itself (src/lib/browser.js). On in every
// build but the test variant of the program, whose tests must not open a browser on the machine they run on: there
// the link is shown and the test opens nothing.
export const BROWSER = import.meta.env.VITE_CUPEL_BROWSER !== "off";

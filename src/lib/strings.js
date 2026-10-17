// Every word the app shows, in English and in French (OPPORTUNITY-PLAN-APPS.md B7). A screen never holds a
// sentence of its own: it asks for one by its key. app/tests/strings.test.mjs fails when a key has no French, when a
// screen asks for a key that is not here, and when a screen holds text that is not a key.
//
// {name} in a string is filled from the values given with the key.

export const LANGUAGES = { en: "English", fr: "Français" };

export const STRINGS = {
  en: {
    "app.name": "Cupel",
    "app.tagline": "Your book of strategies, worked out on your own machine.",
    "app.notAdvice": "Backtests, not advice. A pre-tax research projection. Past results do not predict future ones.",
    "nav.book": "Portfolio", "nav.results": "Results", "nav.optimize": "Optimize", "nav.data": "Data", "nav.account": "Account",
    "lang.label": "Language",

    "core.starting": "Starting the calculator…",
    "core.ready": "The calculator is ready ({seconds} s).",
    "core.failed": "The calculator could not start: {why}",
    "working": "Working…", "stop": "Stop", "stopped": "Stopped.",

    "signin.title": "Sign in",
    "signin.intro": "Sign in with your Cupel account. Your browser opens on cupel's site; sign in there and approve this app. The app then fetches its data by itself. Your accounts, balances and portfolios stay on this machine: nothing about your money is sent to Cupel.",
    "signin.start": "Sign in",
    "signin.waiting": "Your browser has opened cupel's sign-in page. Sign in there, check that it shows this code, and approve:",
    "signin.link": "If the page did not open, open this address in your browser:",
    "signin.open": "Open the page again", "signin.cancel": "Cancel",
    "signin.expired": "That sign-in was not approved in time. Press Sign in to start again.",
    "signin.offline": "cupel could not be reached. Check your connection and try again.",
    "signin.refused": "Not signed in: {why}",
    "account.title": "Account",
    "account.as": "Signed in as {email}, {region}.",
    "account.kept": "Signing out removes the sign-in from this machine. Your portfolios and the data stay here.",
    "account.signout": "Sign out",
    "country.CA": "Canada", "country.US": "United States",

    "data.title": "Data",
    "data.none": "The app has no data yet.",
    "data.first": "The app is fetching its data for the first time.",
    "data.fetching": "fetching the newest data…",
    "data.asOf": "data as of {asOf}",
    "data.offlineShort": "cupel could not be reached",
    "data.inHand": "Data as of {asOf} (release {id}, {runs} strategy runs).",
    "data.again": "Check again now",
    "data.progress": "{done} of {total} parts ({from}: {part})",
    "data.upToDate": "This is the newest data.", "data.updated": "Newer data was fetched and checked.",
    "data.offline": "cupel could not be reached. The app works from the data it has, and will ask again the next time it starts.",
    "data.refused": "The data was refused and the data in hand was kept: {why}",
    "data.from.kept": "already here", "data.from.copied": "unchanged", "data.from.downloaded": "downloaded",
    "check.title": "Self-check",
    "check.intro": "Reference portfolios are computed on this machine and compared with the figures published with the data.",
    "check.run": "Run the self-check", "check.pass": "Passed: {n} reference portfolios match.",
    "check.fail": "FAILED: {name} does not match ({figure}: computed {computed}, published {expected}). Do not rely on results from this copy.",
    "check.none": "This data came with no reference portfolios.",

    "book.title": "Portfolio",
    "book.name": "Name", "book.country": "Country",
    "book.accounts": "Accounts",
    "book.accounts.intro": "Each account's type decides what it may hold: only a margin account may borrow or hold a strategy that sells short.",
    "acct.name": "Account", "acct.type": "Type", "acct.balance": "Balance ({ccy})", "acct.usd": "Of which in US dollars ({ccy})",
    "acct.add": "Add an account", "acct.remove": "Remove", "acct.collateral": "Backs the margin",
    "book.buyingPower": "The margin account's stated buying power ({ccy})",
    "book.margin": "Borrowing", "margin.off": "None", "margin.on": "Up to the buying power",
    "book.rebalance": "Put back to its weights", "rebalance.M": "Monthly", "rebalance.Q": "Quarterly", "rebalance.Y": "Yearly", "rebalance.none": "Never",
    "book.years": "Years of withdrawals", "book.ruin": "Chance of running out (%)", "book.inflation": "Yearly rise of the withdrawal (%)",
    "book.pools": "Your money, by what it may hold",
    "pool.capital": "{amount} {ccy} in all",
    "pool.row": "{label}: {amount} {ccy} ({share} of the total)",
    "book.holdings": "What it holds",
    "book.holdings.none": "Nothing yet. Add strategies from the list below.",
    "hold.strategy": "Strategy", "hold.pool": "Held in", "hold.weight": "% of that money", "hold.remove": "Remove",
    "hold.total": "{label}: {pct} of its money is invested", "hold.cash": "the rest is cash", "hold.over": "more than it has",
    "book.catalogue": "Strategies",
    "cat.search": "Search by name", "cat.sleeve": "Currency", "cat.all": "All", "cat.add": "Add", "cat.added": "Added",
    "cat.name": "Strategy", "cat.grade": "Grade", "cat.cagr": "Growth a year", "cat.none": "No strategy matches.",
    "cat.gradeNote": "The grade is shown beside every strategy and is never used to hide one.",
    "book.export": "Save to a file", "book.import": "Open a file", "book.new": "New portfolio",
    "import.notJson": "That file is not a Cupel portfolio (it is not JSON).",
    "import.notBook": "That file is not a Cupel portfolio.",
    "import.version": "That portfolio was saved by a newer version of Cupel.",
    "import.shape": "That portfolio file is damaged: its accounts or holdings cannot be read.",
    "book.dropped": "{n} holdings were removed: the accounts no longer include the money they were held in.",

    "res.title": "Results",
    "res.evaluate": "Work it out", "res.need": "Add an account and at least one strategy first.",
    "res.asOf": "Data as of {asOf}. {first} to {last}, {days} trading days.",
    "res.withdrawal": "Withdrawal", "res.withdrawal.sub": "{amount} {ccy} a year, rising {inflation} a year, for {years} years, with a {ruin} chance of running out",
    "res.withdrawalFlat": "With no yearly rise", "res.cagr": "Growth a year", "res.sortino": "Sortino", "res.drawdown": "Worst fall",
    "res.drawdown.sub": "{from} to {to}", "res.underWater": "Longest under water", "res.underWater.sub": "{days} days from {from}",
    "res.final": "Final value", "res.curve": "Value over time ({ccy})", "res.fan": "Range of futures while paying the withdrawal ({ccy})",
    "res.fan.note": "Lines: the 5th, 25th, 50th, 75th and 95th of {paths} simulated futures drawn from this portfolio's own months.",
    "res.ruined": "This portfolio reaches zero on {day}: nothing else can be worked out for it.",
    "res.breaks": "Rules this portfolio breaks", "res.breaks.none": "It breaks none of its accounts' rules.",
    "res.cash": "{label}: {pct} of the total is cash, earning nothing",
    "res.holdings": "What each holding does",
    "res.adds": "Adds to the withdrawal", "res.plus5": "5% more of it", "res.minus5": "5% less of it",
    "res.label.hindsight": "A hindsight experiment: fixed weights replayed over the past, chosen knowing it.",
    "res.label.scaling": "Strategy weights are not orders, and a curve scaled to a balance is a standardized model.",
    "res.stale": "The portfolio changed since this was worked out.",

    "opt.title": "Optimize",
    "opt.intro": "Finds the weights of the strategies in your portfolio that best meet one aim, for your accounts. It runs on this machine; nothing about it is sent anywhere.",
    "opt.builder": "Aim", "builder.withdrawal": "The largest withdrawal", "builder.sortino": "The largest Sortino",
    "builder.cagr_dd": "The largest growth within a worst fall", "builder.equal": "Equal weights",
    "opt.maxdd": "Worst fall allowed (%)", "opt.run": "Find the weights", "opt.use": "Use these weights",
    "opt.infeasible": "No mix met every rule; this is the closest found.",
    "opt.note": "Fitted to these accounts and this list as given.",
    "opt.need": "Add at least two strategies to choose among.",
  },

  fr: {
    "app.name": "Cupel",
    "app.tagline": "Votre portefeuille de stratégies, calculé sur votre propre ordinateur.",
    "app.notAdvice": "Des simulations historiques, pas des conseils. Une projection de recherche avant impôts. Les résultats passés ne prédisent pas les résultats futurs.",
    "nav.book": "Portefeuille", "nav.results": "Résultats", "nav.optimize": "Optimiser", "nav.data": "Données", "nav.account": "Compte",
    "lang.label": "Langue",

    "core.starting": "Démarrage du calculateur…",
    "core.ready": "Le calculateur est prêt ({seconds} s).",
    "core.failed": "Le calculateur n'a pas pu démarrer : {why}",
    "working": "Calcul en cours…", "stop": "Arrêter", "stopped": "Arrêté.",

    "signin.title": "Connexion",
    "signin.intro": "Connectez-vous avec votre compte Cupel. Votre navigateur s'ouvre sur le site de cupel; connectez-vous là et approuvez cette application. Elle récupère ensuite ses données elle-même. Vos comptes, vos soldes et vos portefeuilles restent sur cet ordinateur : rien au sujet de votre argent n'est envoyé à Cupel.",
    "signin.start": "Se connecter",
    "signin.waiting": "Votre navigateur a ouvert la page de connexion de cupel. Connectez-vous là, vérifiez qu'elle affiche ce code, puis approuvez :",
    "signin.link": "Si la page ne s'est pas ouverte, ouvrez cette adresse dans votre navigateur :",
    "signin.open": "Ouvrir la page de nouveau", "signin.cancel": "Annuler",
    "signin.expired": "Cette connexion n'a pas été approuvée à temps. Appuyez sur Se connecter pour recommencer.",
    "signin.offline": "Impossible de joindre cupel. Vérifiez votre connexion et réessayez.",
    "signin.refused": "Connexion refusée : {why}",
    "account.title": "Compte",
    "account.as": "Connecté : {email}, {region}.",
    "account.kept": "La déconnexion retire la connexion de cet ordinateur. Vos portefeuilles et les données restent ici.",
    "account.signout": "Se déconnecter",
    "country.CA": "Canada", "country.US": "États-Unis",

    "data.title": "Données",
    "data.none": "L'application n'a pas encore de données.",
    "data.first": "L'application récupère ses données pour la première fois.",
    "data.fetching": "récupération des données les plus récentes…",
    "data.asOf": "données en date du {asOf}",
    "data.offlineShort": "impossible de joindre cupel",
    "data.inHand": "Données en date du {asOf} (version {id}, {runs} exécutions de stratégies).",
    "data.again": "Vérifier de nouveau",
    "data.progress": "{done} de {total} parties ({from} : {part})",
    "data.upToDate": "Ce sont les données les plus récentes.", "data.updated": "Des données plus récentes ont été récupérées et vérifiées.",
    "data.offline": "Impossible de joindre cupel. L'application fonctionne avec les données qu'elle a et réessaiera à son prochain démarrage.",
    "data.refused": "Les données ont été refusées et les données en main ont été conservées : {why}",
    "data.from.kept": "déjà ici", "data.from.copied": "inchangée", "data.from.downloaded": "téléchargée",
    "check.title": "Autovérification",
    "check.intro": "Des portefeuilles de référence sont calculés sur cet ordinateur et comparés aux chiffres publiés avec les données.",
    "check.run": "Lancer l'autovérification", "check.pass": "Réussie : {n} portefeuilles de référence concordent.",
    "check.fail": "ÉCHEC : {name} ne concorde pas ({figure} : calculé {computed}, publié {expected}). Ne vous fiez pas aux résultats de cette copie.",
    "check.none": "Ces données ne comportent aucun portefeuille de référence.",

    "book.title": "Portefeuille",
    "book.name": "Nom", "book.country": "Pays",
    "book.accounts": "Comptes",
    "book.accounts.intro": "Le type de chaque compte décide de ce qu'il peut détenir : seul un compte sur marge peut emprunter ou détenir une stratégie qui vend à découvert.",
    "acct.name": "Compte", "acct.type": "Type", "acct.balance": "Solde ({ccy})", "acct.usd": "Dont en dollars américains ({ccy})",
    "acct.add": "Ajouter un compte", "acct.remove": "Retirer", "acct.collateral": "Garantit la marge",
    "book.buyingPower": "Pouvoir d'achat déclaré du compte sur marge ({ccy})",
    "book.margin": "Emprunt", "margin.off": "Aucun", "margin.on": "Jusqu'au pouvoir d'achat",
    "book.rebalance": "Ramené à ses poids", "rebalance.M": "Chaque mois", "rebalance.Q": "Chaque trimestre", "rebalance.Y": "Chaque année", "rebalance.none": "Jamais",
    "book.years": "Années de retraits", "book.ruin": "Risque d'épuisement (%)", "book.inflation": "Hausse annuelle du retrait (%)",
    "book.pools": "Votre argent, selon ce qu'il peut détenir",
    "pool.capital": "{amount} {ccy} en tout",
    "pool.row": "{label} : {amount} {ccy} ({share} du total)",
    "book.holdings": "Ce qu'il détient",
    "book.holdings.none": "Rien pour l'instant. Ajoutez des stratégies à partir de la liste ci-dessous.",
    "hold.strategy": "Stratégie", "hold.pool": "Détenue dans", "hold.weight": "% de cet argent", "hold.remove": "Retirer",
    "hold.total": "{label} : {pct} de son argent est investi", "hold.cash": "le reste est en liquidités", "hold.over": "plus qu'il n'en a",
    "book.catalogue": "Stratégies",
    "cat.search": "Chercher par nom", "cat.sleeve": "Devise", "cat.all": "Toutes", "cat.add": "Ajouter", "cat.added": "Ajoutée",
    "cat.name": "Stratégie", "cat.grade": "Note", "cat.cagr": "Croissance annuelle", "cat.none": "Aucune stratégie ne correspond.",
    "cat.gradeNote": "La note est affichée à côté de chaque stratégie et ne sert jamais à en cacher une.",
    "book.export": "Enregistrer dans un fichier", "book.import": "Ouvrir un fichier", "book.new": "Nouveau portefeuille",
    "import.notJson": "Ce fichier n'est pas un portefeuille Cupel (ce n'est pas du JSON).",
    "import.notBook": "Ce fichier n'est pas un portefeuille Cupel.",
    "import.version": "Ce portefeuille a été enregistré par une version plus récente de Cupel.",
    "import.shape": "Ce fichier de portefeuille est endommagé : ses comptes ou ses positions sont illisibles.",
    "book.dropped": "{n} positions ont été retirées : les comptes ne comprennent plus l'argent dans lequel elles étaient détenues.",

    "res.title": "Résultats",
    "res.evaluate": "Calculer", "res.need": "Ajoutez d'abord un compte et au moins une stratégie.",
    "res.asOf": "Données en date du {asOf}. Du {first} au {last}, {days} jours de bourse.",
    "res.withdrawal": "Retrait", "res.withdrawal.sub": "{amount} {ccy} par année, en hausse de {inflation} par année, pendant {years} ans, avec un risque d'épuisement de {ruin}",
    "res.withdrawalFlat": "Sans hausse annuelle", "res.cagr": "Croissance annuelle", "res.sortino": "Sortino", "res.drawdown": "Pire baisse",
    "res.drawdown.sub": "du {from} au {to}", "res.underWater": "Plus longue période sous le sommet", "res.underWater.sub": "{days} jours à partir du {from}",
    "res.final": "Valeur finale", "res.curve": "Valeur dans le temps ({ccy})", "res.fan": "Éventail des avenirs en versant le retrait ({ccy})",
    "res.fan.note": "Lignes : les 5e, 25e, 50e, 75e et 95e de {paths} avenirs simulés tirés des mois de ce portefeuille.",
    "res.ruined": "Ce portefeuille tombe à zéro le {day} : rien d'autre ne peut être calculé pour lui.",
    "res.breaks": "Règles que ce portefeuille enfreint", "res.breaks.none": "Il n'enfreint aucune règle de ses comptes.",
    "res.cash": "{label} : {pct} du total est en liquidités, sans rendement",
    "res.holdings": "Ce que fait chaque position",
    "res.adds": "Ajoute au retrait", "res.plus5": "5 % de plus", "res.minus5": "5 % de moins",
    "res.label.hindsight": "Une expérience a posteriori : des poids fixes rejoués sur le passé, choisis en le connaissant.",
    "res.label.scaling": "Les poids des stratégies ne sont pas des ordres, et une courbe ramenée à un solde est un modèle normalisé.",
    "res.stale": "Le portefeuille a changé depuis ce calcul.",

    "opt.title": "Optimiser",
    "opt.intro": "Trouve les poids des stratégies de votre portefeuille qui répondent le mieux à un objectif, pour vos comptes. Le calcul se fait sur cet ordinateur ; rien n'en est envoyé nulle part.",
    "opt.builder": "Objectif", "builder.withdrawal": "Le plus grand retrait", "builder.sortino": "Le plus grand Sortino",
    "builder.cagr_dd": "La plus forte croissance dans une pire baisse donnée", "builder.equal": "Poids égaux",
    "opt.maxdd": "Pire baisse permise (%)", "opt.run": "Trouver les poids", "opt.use": "Utiliser ces poids",
    "opt.infeasible": "Aucune combinaison ne respecte toutes les règles ; voici la plus proche trouvée.",
    "opt.note": "Ajusté à ces comptes et à cette liste telle quelle.",
    "opt.need": "Ajoutez au moins deux stratégies entre lesquelles choisir.",
  },
};

// the system's language when the app has it, else English
export function systemLanguage(nav = globalThis.navigator) {
  const tag = (nav?.language ?? "en").toLowerCase().split("-")[0];
  return tag in STRINGS ? tag : "en";
}

export function translator(lang) {
  const table = STRINGS[lang] ?? STRINGS.en;
  return (key, vars = {}) => {
    const s = table[key] ?? STRINGS.en[key];
    if (s === undefined) throw new Error(`no string ${key}`);
    return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
  };
}

// numbers and money in the language's own way
export function formats(lang) {
  const loc = lang === "fr" ? "fr-CA" : "en-CA";
  return {
    pct: (x, d = 2) => (x == null ? "–" : new Intl.NumberFormat(loc, { style: "percent", minimumFractionDigits: d, maximumFractionDigits: d }).format(x)),
    num: (x, d = 2) => (x == null ? "–" : new Intl.NumberFormat(loc, { minimumFractionDigits: d, maximumFractionDigits: d }).format(x)),
    money: (x) => (x == null ? "–" : new Intl.NumberFormat(loc, { maximumFractionDigits: 0 }).format(x)),
  };
}

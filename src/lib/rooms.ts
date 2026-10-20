// The visit, in order (DECISIONS.md D0.4), with localized slugs (D1.4).
// Previous/next skip rooms that are not open yet, so there is no dead link.
export type Lang = "en" | "fr" | "es";
export const LANGS: Lang[] = ["en", "fr", "es"];
/** Each language's own name, for the switcher (DECISIONS.md D16.1). */
export const LANG_NAME: Record<Lang, string> = { en: "English", fr: "Français", es: "Español" };

export interface Room {
  id: string;
  open: boolean;
  slug: Record<Lang, string>;
  title: Record<Lang, string>;
  teaser: Record<Lang, string>;
}

export const ROOMS: Room[] = [
  {
    id: "hall", open: true, slug: { en: "", fr: "", es: "" },
    title: { en: "Hall: the uberblock", fr: "Hall : l’uberblock", es: "Vestíbulo: el uberblock" },
    teaser: {
      en: "The one record that names the whole pool, and the ring that keeps it.",
      fr: "L’enregistrement qui désigne tout le pool, et l’anneau qui le garde.",
      es: "El único registro que designa todo el pool, y el anillo que lo guarda.",
    },
  },
  {
    id: "history", open: true, slug: { en: "history", fr: "histoire", es: "historia" },
    title: { en: "History wing", fr: "Aile de l’histoire", es: "Ala de la historia" },
    teaser: {
      en: "From the first lines of code to OpenZFS, every fact sourced.",
      fr: "Des premières lignes de code à OpenZFS, chaque fait sourcé.",
      es: "De las primeras líneas de código a OpenZFS, cada hecho con su fuente.",
    },
  },
  {
    id: "tree", open: true, slug: { en: "tree", fr: "arbre", es: "arbol" },
    title: { en: "The tree and the uberblock", fr: "L’arbre et l’uberblock", es: "El árbol y el uberblock" },
    teaser: {
      en: "Block pointers all the way down, and the write that makes a new tree the current one.",
      fr: "Des pointeurs de bloc jusqu’en bas, et l’écriture qui fait d’un nouvel arbre l’arbre courant.",
      es: "Punteros de bloque hasta el fondo, y la escritura que convierte un árbol nuevo en el actual.",
    },
  },
  {
    id: "copy-on-write", open: true, slug: { en: "copy-on-write", fr: "copie-sur-ecriture", es: "copia-en-escritura" },
    title: { en: "Copy-on-write, checksums and self-healing", fr: "Copie sur écriture, sommes de contrôle et autoréparation", es: "Copia en escritura, sumas de comprobación y autorreparación" },
    teaser: {
      en: "Why a pool stays consistent without fsck, and how it catches a disk that lies.",
      fr: "Pourquoi un pool reste cohérent sans fsck, et comment il démasque un disque qui ment.",
      es: "Por qué un pool se mantiene coherente sin fsck, y cómo desenmascara a un disco que miente.",
    },
  },
  {
    id: "txg", open: true, slug: { en: "txg", fr: "txg", es: "txg" },
    title: { en: "Transaction groups", fr: "Groupes de transactions", es: "Grupos de transacciones" },
    teaser: {
      en: "Open, quiescing, syncing: how thousands of writes become one commit.",
      fr: "Ouvert, en clôture, en synchronisation : comment des milliers d’écritures deviennent une seule validation.",
      es: "Abierto, en cierre, en sincronización: cómo miles de escrituras se convierten en una sola confirmación.",
    },
  },
  {
    id: "vdevs", open: true, slug: { en: "vdevs", fr: "vdevs", es: "vdevs" },
    title: { en: "The vdevs", fr: "Les vdevs", es: "Los vdevs" },
    teaser: {
      en: "Mirror, raidz, draid, log, cache, special: the tree of devices under a pool.",
      fr: "Miroir, raidz, draid, log, cache, special : l’arbre des périphériques sous un pool.",
      es: "Espejo, raidz, draid, log, cache, special: el árbol de dispositivos bajo un pool.",
    },
  },
  {
    id: "raidz", open: true, slug: { en: "raidz", fr: "raidz", es: "raidz" },
    title: { en: "RAID-Z", fr: "RAID-Z", es: "RAID-Z" },
    teaser: {
      en: "Variable-width stripes, and why there is no write hole.",
      fr: "Des bandes de largeur variable, et pourquoi il n’y a pas de trou d’écriture.",
      es: "Bandas de ancho variable, y por qué no hay agujero de escritura.",
    },
  },
  {
    id: "snapshots", open: true, slug: { en: "snapshots", fr: "instantanes", es: "instantaneas" },
    title: { en: "Snapshots and clones", fr: "Instantanés et clones", es: "Instantáneas y clones" },
    teaser: {
      en: "Birth times and deadlists: which snapshot owns this block?",
      fr: "Dates de naissance et deadlists : à quel instantané appartient ce bloc ?",
      es: "Fechas de nacimiento y deadlists: ¿a qué instantánea pertenece este bloque?",
    },
  },
  {
    id: "arc", open: true, slug: { en: "arc", fr: "arc", es: "arc" },
    title: { en: "The ARC", fr: "L’ARC", es: "El ARC" },
    teaser: {
      en: "A cache that learns from what it forgot.",
      fr: "Un cache qui apprend de ce qu’il a oublié.",
      es: "Una caché que aprende de lo que olvidó.",
    },
  },
  {
    id: "metaslabs", open: true, slug: { en: "metaslabs", fr: "metaslabs", es: "metaslabs" },
    title: { en: "Metaslabs and space maps", fr: "Metaslabs et space maps", es: "Metaslabs y space maps" },
    teaser: {
      en: "Finding free space fast, with an append-only log of allocations.",
      fr: "Trouver vite de l’espace libre, avec un journal d’allocations en ajout seul.",
      es: "Encontrar espacio libre deprisa, con un registro de asignaciones que solo crece.",
    },
  },
  {
    id: "zil", open: true, slug: { en: "zil", fr: "zil", es: "zil" },
    title: { en: "ZIL and SLOG", fr: "ZIL et SLOG", es: "ZIL y SLOG" },
    teaser: {
      en: "The path of a synchronous write.",
      fr: "Le chemin d’une écriture synchrone.",
      es: "El camino de una escritura síncrona.",
    },
  },
  {
    id: "send-receive", open: true, slug: { en: "send-receive", fr: "send-receive", es: "send-receive" },
    title: { en: "send / receive", fr: "send / receive", es: "send / receive" },
    teaser: {
      en: "A dataset as a stream, and the increment between two snapshots.",
      fr: "Un dataset en flux, et l’incrément entre deux instantanés.",
      es: "Un dataset como flujo, y el incremento entre dos instantáneas.",
    },
  },
  {
    id: "compression-dedup-encryption", open: true,
    slug: { en: "compression-dedup-encryption", fr: "compression-dedup-chiffrement", es: "compresion-dedup-cifrado" },
    title: { en: "Compression, dedup, encryption", fr: "Compression, déduplication, chiffrement", es: "Compresión, deduplicación, cifrado" },
    teaser: {
      en: "Three transforms in the write pipeline, and the honest cost of dedup.",
      fr: "Trois transformations dans le pipeline d’écriture, et le vrai coût de la déduplication.",
      es: "Tres transformaciones en el pipeline de escritura, y el coste real de la deduplicación.",
    },
  },
  {
    id: "engine-room", open: true, slug: { en: "engine-room", fr: "salle-des-machines", es: "sala-de-maquinas" },
    title: { en: "Engine room", fr: "Salle des machines", es: "Sala de máquinas" },
    teaser: {
      en: "How this museum was built, and from which commit.",
      fr: "Comment ce musée a été construit, et à partir de quel commit.",
      es: "Cómo se construyó este museo, y a partir de qué commit.",
    },
  },
];

export function room(id: string): Room {
  const r = ROOMS.find((x) => x.id === id);
  if (!r) throw new Error(`unknown room ${id}`);
  return r;
}

export function roomUrl(lang: Lang, id: string): string {
  const s = room(id).slug[lang];
  return s ? `/${lang}/${s}/` : `/${lang}/`;
}

/** Position in the visit (the Hall is 0). */
export function roomNumber(id: string): number {
  return ROOMS.findIndex((x) => x.id === id);
}

/** Previous and next open rooms. */
export function neighbours(id: string): { prev?: Room; next?: Room } {
  const open = ROOMS.filter((x) => x.open);
  const i = open.findIndex((x) => x.id === id);
  return { prev: open[i - 1], next: open[i + 1] };
}


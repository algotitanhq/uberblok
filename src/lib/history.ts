// The History wing's content (DECISIONS.md D2.1). Every sentence that states a
// fact, a date, a name or a quote ends with its citation `[[Sxx]]`, an entry of
// SOURCES.md; FR, EN and ES cite the same entries per milestone (checked in CI by
// scripts/check-sources.mjs). Quotes stay in their original language.
import type { Lang } from "./rooms";
import { fr } from "./fr";

export interface Milestone {
  /** Anchor id, the same in every language. */
  id: string;
  /** ISO date at the precision the source gives: YYYY, YYYY-MM or YYYY-MM-DD. */
  date: string;
  title: Record<Lang, string>;
  /** HTML, one or more <p>, with [[Sxx]] citations. */
  text: Record<Lang, string>;
}

export interface Era {
  id: string;
  span: string;
  title: Record<Lang, string>;
  milestones: Milestone[];
}

// French spacing: see fr.ts. Written with plain spaces below.
const m = (x: Milestone): Milestone => ({
  ...x,
  title: { en: x.title.en, fr: fr(x.title.fr), es: x.title.es },
  text: { en: x.text.en, fr: fr(x.text.fr), es: x.text.es },
});

const quote = (
  q: string,
  who: string,
  frWho: string,
  frTranslation: string,
  esWho: string,
  esTranslation: string,
) => ({
  en: `<blockquote><p>${q}</p><footer>${who}</footer></blockquote>`,
  fr: `<blockquote><p lang="en">${q}</p><footer>${frWho}</footer></blockquote><p class="translation">Notre traduction : « ${frTranslation} »</p>`,
  es: `<blockquote><p lang="en">${q}</p><footer>${esWho}</footer></blockquote><p class="translation">Traducción nuestra: «${esTranslation}»</p>`,
});

const moore = quote(
  "one of the design principles we set for ZFS was: never, ever trust the underlying hardware.[[S04]]",
  "Bill Moore, interviewed by ACM Queue, 2007",
  "Bill Moore, entretien avec ACM Queue, 2007",
  "l’un des principes de conception que nous nous sommes fixés pour ZFS : ne jamais, au grand jamais, faire confiance au matériel sous-jacent.",
  "Bill Moore, entrevistado por ACM Queue, 2007",
  "uno de los principios de diseño que nos fijamos para ZFS fue: no confiar jamás, bajo ningún concepto, en el hardware subyacente.",
);

export const ERAS: Era[] = [
  {
    id: "sun",
    span: "2001–2007",
    title: { en: "At Sun Microsystems", fr: "Chez Sun Microsystems", es: "En Sun Microsystems" },
    milestones: [
      m({
        id: "m-2001-two-engineers",
        date: "2001",
        title: { en: "Two engineers at Sun", fr: "Deux ingénieurs chez Sun", es: "Dos ingenieros en Sun" },
        text: {
          en: `<p>Development of ZFS starts at Sun Microsystems with two engineers.[[S01]] Jeff Bonwick leads it, with Bill Moore as co-lead;[[S02]] the OpenZFS project would later call Matt Ahrens one of the two original authors of ZFS.[[S03]]</p>${moore.en}`,
          fr: `<p>Le développement de ZFS commence chez Sun Microsystems, avec deux ingénieurs.[[S01]] Jeff Bonwick le dirige, avec Bill Moore pour codirecteur ;[[S02]] le projet OpenZFS présentera plus tard Matt Ahrens comme l’un des deux auteurs d’origine de ZFS.[[S03]]</p>${moore.fr}`,
          es: `<p>El desarrollo de ZFS comienza en Sun Microsystems con dos ingenieros.[[S01]] Jeff Bonwick lo dirige, con Bill Moore como codirector;[[S02]] el proyecto OpenZFS presentaría más tarde a Matt Ahrens como uno de los dos autores originales de ZFS.[[S03]]</p>${moore.es}`,
        },
      }),
      m({
        id: "m-2001-prototype",
        date: "2001-10-31",
        title: { en: "A prototype, then a mount", fr: "Un prototype, puis un montage", es: "Un prototipo y luego un montaje" },
        text: {
          en: `<p>The user-level prototype of ZFS works on 31 October 2001.[[S05]] A year later to the day, on 31 October 2002, ZFS is mounted in the kernel for the first time.[[S06]]</p>`,
          fr: `<p>Le prototype de ZFS en espace utilisateur fonctionne le 31 octobre 2001.[[S05]] Un an plus tard jour pour jour, le 31 octobre 2002, ZFS est monté dans le noyau pour la première fois.[[S06]]</p>`,
          es: `<p>El prototipo de ZFS en espacio de usuario funciona el 31 de octubre de 2001.[[S05]] Justo un año después, el 31 de octubre de 2002, ZFS se monta en el núcleo por primera vez.[[S06]]</p>`,
        },
      }),
      m({
        id: "m-2005-integration",
        date: "2005-10-31",
        title: { en: "Into the Solaris source", fr: "Dans les sources de Solaris", es: "En el código fuente de Solaris" },
        text: {
          en: `<p>ZFS is integrated into Solaris on 31 October 2005.[[S07]] The commit, titled <q>PSARC 2002/240 ZFS</q> and <q>6338653 Integrate ZFS</q>, is still readable in the illumos-gate repository.[[S09]] Jeff Bonwick sums up the integration in one line: <q>584 files, 92,000 lines of change, 56 patents, 5 years</q>.[[S08]]</p>`,
          fr: `<p>ZFS est intégré à Solaris le 31 octobre 2005.[[S07]] Le commit, intitulé <q lang="en">PSARC 2002/240 ZFS</q> et <q lang="en">6338653 Integrate ZFS</q>, se lit encore dans le dépôt illumos-gate.[[S09]] Jeff Bonwick résume l’intégration en une ligne : <q lang="en">584 files, 92,000 lines of change, 56 patents, 5 years</q> (584 fichiers, 92 000 lignes modifiées, 56 brevets, 5 ans ; notre traduction).[[S08]]</p>`,
          es: `<p>ZFS se integra en Solaris el 31 de octubre de 2005.[[S07]] El commit, titulado <q lang="en">PSARC 2002/240 ZFS</q> y <q lang="en">6338653 Integrate ZFS</q>, todavía puede leerse en el repositorio illumos-gate.[[S09]] Jeff Bonwick resume la integración en una línea: <q lang="en">584 files, 92,000 lines of change, 56 patents, 5 years</q> (584 archivos, 92 000 líneas modificadas, 56 patentes, 5 años; traducción nuestra).[[S08]]</p>`,
        },
      }),
      m({
        id: "m-2005-opensolaris",
        date: "2005-11",
        title: { en: "Open source, in OpenSolaris", fr: "Code ouvert, dans OpenSolaris", es: "Código abierto, en OpenSolaris" },
        text: {
          en: `<p>The source code of ZFS is released under the CDDL, as part of OpenSolaris.[[S12]] ZFS is available in build 27a of OpenSolaris and Solaris Express;[[S10]] on 17 November 2005 Jeff Bonwick writes of <q>the ZFS launch today</q>.[[S11]]</p>`,
          fr: `<p>Le code source de ZFS est publié sous licence CDDL, au sein d’OpenSolaris.[[S12]] ZFS est disponible dans le build 27a d’OpenSolaris et de Solaris Express ;[[S10]] le 17 novembre 2005, Jeff Bonwick évoque <q lang="en">the ZFS launch today</q>, le lancement de ZFS ce jour-là.[[S11]]</p>`,
          es: `<p>El código fuente de ZFS se publica bajo la CDDL, como parte de OpenSolaris.[[S12]] ZFS está disponible en la build 27a de OpenSolaris y Solaris Express;[[S10]] el 17 de noviembre de 2005, Jeff Bonwick escribe sobre <q lang="en">the ZFS launch today</q>, el lanzamiento de ZFS ese mismo día.[[S11]]</p>`,
        },
      }),
      m({
        id: "m-2006-solaris-10",
        date: "2006",
        title: { en: "In Solaris 10 6/06", fr: "Dans Solaris 10 6/06", es: "En Solaris 10 6/06" },
        text: {
          en: `<p>On 2 May 2006 Sun announces Solaris ZFS 1.0 for June, in the next commercial release, Solaris 10 6/06.[[S13]] Oracle’s Solaris documentation lists ZFS as new in that release.[[S14]]</p>`,
          fr: `<p>Le 2 mai 2006, Sun annonce Solaris ZFS 1.0 pour juin, dans la prochaine version commerciale, Solaris 10 6/06.[[S13]] La documentation de Solaris, chez Oracle, présente ZFS comme une nouveauté de cette version.[[S14]]</p>`,
          es: `<p>El 2 de mayo de 2006, Sun anuncia Solaris ZFS 1.0 para junio, en la siguiente versión comercial, Solaris 10 6/06.[[S13]] La documentación de Solaris de Oracle presenta ZFS como novedad de esa versión.[[S14]]</p>`,
        },
      }),
      m({
        id: "m-2007-freebsd",
        date: "2007-04-06",
        title: { en: "FreeBSD", fr: "FreeBSD", es: "FreeBSD" },
        text: {
          en: `<p>Pawel Jakub Dawidek commits ZFS to FreeBSD on 6 April 2007: <q>Please welcome ZFS - The last word in file systems.</q>[[S15]] FreeBSD 7.0, announced on 27 February 2008, ships it as experimental.[[S16]]</p>`,
          fr: `<p>Pawel Jakub Dawidek intègre ZFS à FreeBSD le 6 avril 2007 : <q lang="en">Please welcome ZFS - The last word in file systems.</q>[[S15]] FreeBSD 7.0, annoncé le 27 février 2008, le livre à titre expérimental.[[S16]]</p>`,
          es: `<p>Pawel Jakub Dawidek incorpora ZFS a FreeBSD el 6 de abril de 2007: <q lang="en">Please welcome ZFS - The last word in file systems.</q>[[S15]] FreeBSD 7.0, anunciado el 27 de febrero de 2008, lo incluye con carácter experimental.[[S16]]</p>`,
        },
      }),
    ],
  },
  {
    id: "after-sun",
    span: "2008–2013",
    title: { en: "Oracle, illumos, Linux", fr: "Oracle, illumos, Linux", es: "Oracle, illumos, Linux" },
    milestones: [
      m({
        id: "m-2008-linux",
        date: "2008",
        title: { en: "A native port, at Livermore", fr: "Un portage natif, à Livermore", es: "Una adaptación nativa, en Livermore" },
        text: {
          en: `<p>Development of a native Linux port starts in 2008.[[S22]] The first commit of its ZFS code, <q>Initial Linux ZFS GIT Repo</q>, is by Brian Behlendorf, on 20 November 2008;[[S23]] he is the principal developer of the port, as a computer scientist at Lawrence Livermore National Laboratory.[[S24]]</p><p>The code stays under the CDDL. The OpenZFS documentation states that this prevents distributing it as part of the Linux kernel binary, and that nothing in either licence prevents distributing it as a binary module or as source code.[[S25]]</p>`,
          fr: `<p>Le développement d’un portage natif pour Linux commence en 2008.[[S22]] Le premier commit de son code ZFS, <q lang="en">Initial Linux ZFS GIT Repo</q>, est de Brian Behlendorf, le 20 novembre 2008 ;[[S23]] il est le développeur principal du portage, informaticien au Lawrence Livermore National Laboratory.[[S24]]</p><p>Le code reste sous CDDL. La documentation d’OpenZFS indique que cela empêche de le distribuer dans le binaire du noyau Linux, et que rien dans l’une ou l’autre licence n’empêche de le distribuer en module binaire ou en code source.[[S25]]</p>`,
          es: `<p>El desarrollo de una adaptación nativa para Linux comienza en 2008.[[S22]] El primer commit de su código ZFS, <q lang="en">Initial Linux ZFS GIT Repo</q>, es de Brian Behlendorf, el 20 de noviembre de 2008;[[S23]] es el desarrollador principal de la adaptación, como informático del Lawrence Livermore National Laboratory.[[S24]]</p><p>El código sigue bajo la CDDL. La documentación de OpenZFS indica que eso impide distribuirlo como parte del binario del núcleo Linux, y que nada en ninguna de las dos licencias impide distribuirlo como módulo binario o como código fuente.[[S25]]</p>`,
        },
      }),
      m({
        id: "m-2010-oracle",
        date: "2010-01-27",
        title: { en: "Oracle acquires Sun", fr: "Oracle rachète Sun", es: "Oracle adquiere Sun" },
        text: {
          en: `<p>Oracle completes its acquisition of Sun Microsystems on 27 January 2010.[[S17]]</p>`,
          fr: `<p>Oracle achève le rachat de Sun Microsystems le 27 janvier 2010.[[S17]]</p>`,
          es: `<p>Oracle completa la adquisición de Sun Microsystems el 27 de enero de 2010.[[S17]]</p>`,
        },
      }),
      m({
        id: "m-2010-illumos",
        date: "2010-08-03",
        title: { en: "illumos", fr: "illumos", es: "illumos" },
        text: {
          en: `<p>Garrett D’Amore announces the illumos project on 3 August 2010,[[S18]] <q>a community maintained derivative of the OpenSolaris ON source</q>.[[S19]]</p>`,
          fr: `<p>Garrett D’Amore annonce le projet illumos le 3 août 2010,[[S18]] <q lang="en">a community maintained derivative of the OpenSolaris ON source</q>, un dérivé des sources ON d’OpenSolaris maintenu par la communauté.[[S19]]</p>`,
          es: `<p>Garrett D’Amore anuncia el proyecto illumos el 3 de agosto de 2010,[[S18]] <q lang="en">a community maintained derivative of the OpenSolaris ON source</q>, un derivado del código fuente ON de OpenSolaris mantenido por la comunidad.[[S19]]</p>`,
        },
      }),
      m({
        id: "m-2010-diverge",
        date: "2010-08",
        title: { en: "Two lines of ZFS", fr: "Deux lignées de ZFS", es: "Dos líneas de ZFS" },
        text: {
          en: `<p>OpenSolaris is discontinued, and further development of ZFS on Solaris is no longer open source.[[S20]] On 19 August 2010 Garrett D’Amore reports the last update of Oracle’s public ON repository: <q>From here on out, Illumos and Oracle Solaris diverge.</q>[[S21]]</p>`,
          fr: `<p>OpenSolaris est abandonné, et la suite du développement de ZFS dans Solaris n’est plus open source.[[S20]] Le 19 août 2010, Garrett D’Amore signale la dernière mise à jour du dépôt ON public d’Oracle : <q lang="en">From here on out, Illumos and Oracle Solaris diverge.</q> (Désormais, illumos et Oracle Solaris divergent ; notre traduction.)[[S21]]</p>`,
          es: `<p>Se abandona OpenSolaris, y el desarrollo posterior de ZFS en Solaris deja de ser de código abierto.[[S20]] El 19 de agosto de 2010, Garrett D’Amore informa de la última actualización del repositorio ON público de Oracle: <q lang="en">From here on out, Illumos and Oracle Solaris diverge.</q> (A partir de ahora, illumos y Oracle Solaris divergen; traducción nuestra.)[[S21]]</p>`,
        },
      }),
      m({
        id: "m-2013-zol-0-6-1",
        date: "2013-03",
        title: { en: "ZFS on Linux 0.6.1", fr: "ZFS on Linux 0.6.1", es: "ZFS on Linux 0.6.1" },
        text: {
          en: `<p>ZFS on Linux 0.6.1 is released in March 2013, <q>Produced at Lawrence Livermore National Laboratory</q>.[[S26]] The OpenZFS project’s history records 2013 as the year of the first stable release of ZFS on Linux.[[S27]]</p>`,
          fr: `<p>ZFS on Linux 0.6.1 sort en mars 2013, <q lang="en">Produced at Lawrence Livermore National Laboratory</q>.[[S26]] L’historique du projet OpenZFS retient 2013 comme l’année de la première version stable de ZFS on Linux.[[S27]]</p>`,
          es: `<p>ZFS on Linux 0.6.1 se publica en marzo de 2013, <q lang="en">Produced at Lawrence Livermore National Laboratory</q>.[[S26]] La historia del proyecto OpenZFS señala 2013 como el año de la primera versión estable de ZFS on Linux.[[S27]]</p>`,
        },
      }),
    ],
  },
  {
    id: "openzfs",
    span: "2013–2026",
    title: { en: "OpenZFS", fr: "OpenZFS", es: "OpenZFS" },
    milestones: [
      m({
        id: "m-2013-openzfs",
        date: "2013-09-17",
        title: { en: "OpenZFS is announced", fr: "Annonce d’OpenZFS", es: "Anuncio de OpenZFS" },
        text: {
          en: `<p>OpenZFS is announced on 17 September 2013 as <q>the truly open source successor to the ZFS project</q>,[[S28]] founded by members of the Linux, FreeBSD, Mac OS X and illumos communities.[[S29]]</p>`,
          fr: `<p>OpenZFS est annoncé le 17 septembre 2013 comme <q lang="en">the truly open source successor to the ZFS project</q>, le successeur véritablement open source du projet ZFS,[[S28]] fondé par des membres des communautés Linux, FreeBSD, Mac OS X et illumos.[[S29]]</p>`,
          es: `<p>OpenZFS se anuncia el 17 de septiembre de 2013 como <q lang="en">the truly open source successor to the ZFS project</q>, el sucesor verdaderamente de código abierto del proyecto ZFS,[[S28]] fundado por miembros de las comunidades de Linux, FreeBSD, Mac OS X e illumos.[[S29]]</p>`,
        },
      }),
      m({
        id: "m-2017-encryption",
        date: "2017-08-14",
        title: { en: "Native encryption", fr: "Chiffrement natif", es: "Cifrado nativo" },
        text: {
          en: `<p>Tom Caputi commits native encryption on 14 August 2017.[[S30]] It first ships in ZFS on Linux 0.8.0, in May 2019.[[S31]]</p>`,
          fr: `<p>Tom Caputi intègre le chiffrement natif le 14 août 2017.[[S30]] Il sort pour la première fois dans ZFS on Linux 0.8.0, en mai 2019.[[S31]]</p>`,
          es: `<p>Tom Caputi incorpora el cifrado nativo el 14 de agosto de 2017.[[S30]] Se publica por primera vez en ZFS on Linux 0.8.0, en mayo de 2019.[[S31]]</p>`,
        },
      }),
      m({
        id: "m-2020-draid",
        date: "2020-11-13",
        title: { en: "dRAID", fr: "dRAID", es: "dRAID" },
        text: {
          en: `<p>dRAID, distributed spare RAID, is committed on 13 November 2020, co-authored by Isaac Huang, Mark Maybee, Don Brady, Matthew Ahrens and Brian Behlendorf.[[S32]] It first ships in OpenZFS 2.1.0, in July 2021: a distributed variant of RAID-Z whose integrated hot spares make resilvering much faster.[[S33]]</p>`,
          fr: `<p>dRAID, le RAID à disques de secours distribués, est intégré le 13 novembre 2020, coécrit par Isaac Huang, Mark Maybee, Don Brady, Matthew Ahrens et Brian Behlendorf.[[S32]] Il sort pour la première fois dans OpenZFS 2.1.0, en juillet 2021 : une variante distribuée de RAIDZ dont les disques de secours intégrés rendent la reconstruction bien plus rapide.[[S33]]</p>`,
          es: `<p>dRAID, el RAID con repuestos distribuidos (distributed spare RAID), se incorpora el 13 de noviembre de 2020, con Isaac Huang, Mark Maybee, Don Brady, Matthew Ahrens y Brian Behlendorf como coautores.[[S32]] Se publica por primera vez en OpenZFS 2.1.0, en julio de 2021: una variante distribuida de RAID-Z cuyos discos de repuesto integrados hacen mucho más rápido el resilver (la resincronización de un disco).[[S33]]</p>`,
        },
      }),
      m({
        id: "m-2020-openzfs-2",
        date: "2020-11-30",
        title: { en: "OpenZFS 2.0: one repository", fr: "OpenZFS 2.0 : un seul dépôt", es: "OpenZFS 2.0: un solo repositorio" },
        text: {
          en: `<p>OpenZFS 2.0.0 supports Linux and FreeBSD from the same repository, and ZFS on Linux is renamed OpenZFS.[[S34]] In FreeBSD 13.0, announced on 13 April 2021, the ZFS implementation is provided by OpenZFS.[[S35]]</p>`,
          fr: `<p>OpenZFS 2.0.0 prend en charge Linux et FreeBSD depuis un même dépôt, et ZFS on Linux devient OpenZFS.[[S34]] Dans FreeBSD 13.0, annoncé le 13 avril 2021, l’implémentation de ZFS est celle d’OpenZFS.[[S35]]</p>`,
          es: `<p>OpenZFS 2.0.0 da soporte a Linux y FreeBSD desde el mismo repositorio, y ZFS on Linux pasa a llamarse OpenZFS.[[S34]] En FreeBSD 13.0, anunciado el 13 de abril de 2021, la implementación de ZFS la proporciona OpenZFS.[[S35]]</p>`,
        },
      }),
      m({
        id: "m-2023-block-cloning",
        date: "2023-10",
        title: { en: "OpenZFS 2.2: block cloning", fr: "OpenZFS 2.2 : clonage de blocs", es: "OpenZFS 2.2: clonación de bloques" },
        text: {
          en: `<p>OpenZFS 2.2.0 brings block cloning: a file, or part of one, can be copied by referencing its existing blocks instead of copying them.[[S36]]</p>`,
          fr: `<p>OpenZFS 2.2.0 apporte le clonage de blocs : un fichier, ou une partie, peut être copié en référençant ses blocs existants au lieu de les recopier.[[S36]]</p>`,
          es: `<p>OpenZFS 2.2.0 trae la clonación de bloques: un archivo, o parte de él, puede copiarse haciendo referencia a sus bloques existentes en lugar de copiarlos.[[S36]]</p>`,
        },
      }),
      m({
        id: "m-2023-raidz-expansion",
        date: "2023-11-08",
        title: { en: "RAID-Z expansion", fr: "Extension de RAID-Z", es: "Ampliación de RAID-Z" },
        text: {
          en: `<p>RAID-Z expansion is committed on 8 November 2023; the commit names Matthew Ahrens as its author.[[S37]] It ships in OpenZFS 2.3.0, in January 2025, with fast dedup, Direct IO and JSON output.[[S38]]</p>`,
          fr: `<p>L’extension de RAID-Z est intégrée le 8 novembre 2023 ; le commit en désigne Matthew Ahrens comme auteur.[[S37]] Elle sort dans OpenZFS 2.3.0, en janvier 2025, avec la déduplication rapide, les E/S directes (Direct IO) et la sortie JSON.[[S38]]</p>`,
          es: `<p>La ampliación de RAID-Z se incorpora el 8 de noviembre de 2023; en el commit figura Matthew Ahrens como autor.[[S37]] Se publica en OpenZFS 2.3.0, en enero de 2025, junto con la deduplicación rápida, la E/S directa (Direct IO) y la salida en JSON.[[S38]]</p>`,
        },
      }),
      m({
        id: "m-2025-openzfs-2-4",
        date: "2025-12",
        title: { en: "OpenZFS 2.4", fr: "OpenZFS 2.4", es: "OpenZFS 2.4" },
        text: {
          en: `<p>OpenZFS 2.4.0 adds default quotas, uncached IO and unified allocation throttling.[[S39]]</p>`,
          fr: `<p>OpenZFS 2.4.0 ajoute les quotas par défaut, les E/S sans cache et une régulation unifiée des allocations.[[S39]]</p>`,
          es: `<p>OpenZFS 2.4.0 añade las cuotas por defecto, la E/S sin caché y la regulación unificada de las asignaciones.[[S39]]</p>`,
        },
      }),
      m({
        id: "m-2026-openzfs-2-4-4",
        date: "2026-08",
        title: { en: "OpenZFS 2.4.4, the release this museum reads", fr: "OpenZFS 2.4.4, la version que lit ce musée", es: "OpenZFS 2.4.4, la versión que lee este museo" },
        text: {
          en: `<p>OpenZFS 2.4.4 is a point release, for Linux 4.18 to 7.2 and FreeBSD 13.3 and later.[[S40]] Every code excerpt in the rooms of this museum is quoted from it.</p>`,
          fr: `<p>OpenZFS 2.4.4 est une version corrective, pour Linux 4.18 à 7.2 et FreeBSD 13.3 et suivants.[[S40]] Tous les extraits de code des salles de ce musée en sont tirés.</p>`,
          es: `<p>OpenZFS 2.4.4 es una versión de mantenimiento, para Linux 4.18 a 7.2 y FreeBSD 13.3 y posteriores.[[S40]] Todos los extractos de código de las salas de este museo proceden de ella.</p>`,
        },
      }),
    ],
  },
];

const LOCALE: Record<Lang, string> = { en: "en-GB", fr: "fr-FR", es: "es-ES" };

/** "31 October 2005", "June 2006", "2001" (and the French forms). */
export function dateLabel(iso: string, lang: Lang): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!m) return String(y);
  const date = new Date(Date.UTC(y, m - 1, d ?? 1));
  const opts: Intl.DateTimeFormatOptions = d
    ? { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }
    : { month: "long", year: "numeric", timeZone: "UTC" };
  return new Intl.DateTimeFormat(LOCALE[lang], opts).format(date);
}

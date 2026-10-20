// The frozen OpenZFS commit (DECISIONS.md D0.1). Every link on the site uses
// the full SHA; CI runs scripts/check-permalinks.mjs over the built HTML.
export const OPENZFS_TAG = "zfs-2.4.4";
export const OPENZFS_SHA = "71a9f9578616a90c3c14bb59629fb4d31bfd68d1";

/** GitHub permalink to a file and line range at the frozen commit. */
export function gh(path: string, from: number, to?: number): string {
  const range = to && to !== from ? `#L${from}-L${to}` : `#L${from}`;
  return `https://github.com/openzfs/zfs/blob/${OPENZFS_SHA}/${path}${range}`;
}

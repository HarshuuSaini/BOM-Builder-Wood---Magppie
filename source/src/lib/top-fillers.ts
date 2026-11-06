export type TopFillerSettings = { enabled: boolean; heightMm: string; cabinetTypes: Array<"wall" | "tall"> };
export const DEFAULT_TOP_FILLERS: TopFillerSettings = { enabled: false, heightMm: "100", cabinetTypes: ["wall", "tall"] };
export function validTopFillerSettings(value: unknown): value is TopFillerSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as TopFillerSettings;
  return typeof v.enabled === "boolean" && typeof v.heightMm === "string" && /^\d{1,4}$/.test(v.heightMm) && Number(v.heightMm) > 0 && Number(v.heightMm) <= 2440 &&
    Array.isArray(v.cabinetTypes) && v.cabinetTypes.length <= 2 && new Set(v.cabinetTypes).size === v.cabinetTypes.length &&
    v.cabinetTypes.every(z => z === "wall" || z === "tall") && (!v.enabled || v.cabinetTypes.length > 0);
}
export type TopFillerSegment = { id: string; runKey: string; label: string; width: number; height: number; zone: "wall" | "tall"; elevation: string; lineId: number; finish: string };
export type TopFillerMerge = { runKey: string; memberIds: string[] };
export type TopFillerPiece = { id: string; runKey: string; members: TopFillerSegment[]; width: number; height: number; explicit: boolean };
export function validTopFillerMerges(value: unknown): value is TopFillerMerge[] {
  return Array.isArray(value) && value.length <= 5000 && value.every(m => m && typeof m === "object" && typeof m.runKey === "string" && m.runKey.length <= 10000 &&
    Array.isArray(m.memberIds) && m.memberIds.length >= 2 && m.memberIds.length <= 10000 && new Set(m.memberIds).size === m.memberIds.length &&
    m.memberIds.every((id: unknown) => typeof id === "string" && id.length <= 200));
}
/** Existing explicit groups are preserved; all remaining members form one remainder piece. */
export function topFillerPieces(segments: TopFillerSegment[], merges: TopFillerMerge[]): TopFillerPiece[] {
  const runs = new Map<string, TopFillerSegment[]>();
  for (const s of segments) runs.set(s.runKey, [...(runs.get(s.runKey) ?? []), s]);
  const pieces: TopFillerPiece[] = [];
  for (const [runKey, members] of runs) {
    const available = new Map(members.map(m => [m.id, m]));
    const emit = (group: TopFillerSegment[], explicit: boolean) => {
      if (!group.length) return;
      pieces.push({ id: JSON.stringify(group.map(s => s.id)), runKey, members: group, height: group[0].height,
        width: group.reduce((sum, s) => sum + s.width, 0), explicit });
      group.forEach(s => available.delete(s.id));
    };
    for (const merge of merges.filter(m => m.runKey === runKey)) emit(merge.memberIds.flatMap(id => available.has(id) ? [available.get(id)!] : []), true);
    emit([...available.values()], false);
  }
  return pieces;
}
export function mergeTopFillers(merges: TopFillerMerge[], runKey: string, ids: string[]): TopFillerMerge[] {
  const selected = [...new Set(ids)];
  if (selected.length < 2) return merges;
  const remove = new Set(selected);
  return [...merges.flatMap(m => {
    if (m.runKey !== runKey) return [m];
    const memberIds = m.memberIds.filter(id => !remove.has(id));
    return memberIds.length >= 2 ? [{ ...m, memberIds }] : [];
  }), { runKey, memberIds: selected }];
}

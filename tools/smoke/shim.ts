export const normalizePartOrPanelName = (s: string) => s.replace(/\s+/g," ").trim();
export const getPartBaseName = (n: string, d: string|null, f: string) =>
  `Part - ${n.replace(/^Panels-\s*/,"")} ${d??""} ${f}`.replace(/\s+/g," ").trim();
export const getPanelBaseName = (n: string, d: string|null, f: string) =>
  `Panel - ${n.replace(/^Panels-\s*/,"")} ${f}`.replace(/\s+/g," ").trim();

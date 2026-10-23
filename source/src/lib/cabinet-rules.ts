export function blindOpeningLimits(zone: string): { min: number; max: number; defaultWidth: number } {
  if (zone === "BB" || zone === "BBL") return { min: 300, max: 600, defaultWidth: 550 };
  if (zone === "WB") return { min: 350, max: 600, defaultWidth: 450 };
  return { min: 450, max: 550, defaultWidth: zone === "LB" || zone === "LBF" ? 450 : 550 };
}

export function isDoubleShutterWidth(width: number): boolean {
  return width > 600;
}

export function shelfCodeToken(token: string, shelfQty: number, isWall: boolean, glassShelf: boolean): string {
  if (!/^\d+(?:SG|SX)$/.test(token)) return token;
  if (isWall && shelfQty === 0) return "XXX";
  return isWall ? `${shelfQty}${glassShelf ? "SG" : "SX"}` : token;
}

export function tallApplianceDrawerCode(count: number): string {
  return `${count}LB`;
}

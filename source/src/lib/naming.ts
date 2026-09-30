export function splitDrillAndFinish(afterSizeStr: string): { drill: string; finish: string } {
  const words = afterSizeStr.split(/\s+/);
  const drillWords: string[] = [];
  const finishWords: string[] = [];

  const isDrillWord = (w: string) => {
    const word = w.trim().toUpperCase();
    if (word === "LH" || word === "RH" || word === "LHS" || word === "RHS" || word === "/") return true;
    if (/^\d+S$/i.test(word)) return true; // e.g. 3S
    if (/^\d+H$/i.test(word)) return true; // e.g. 4H
    if (/^\d+HB$/i.test(word)) return true; // e.g. 2HB
    if (word === "JD" || word === "JD1" || word === "JD2") return true;
    return false;
  };

  let inFinish = false;
  for (const w of words) {
    if (inFinish) {
      finishWords.push(w);
    } else {
      if (isDrillWord(w)) {
        drillWords.push(w);
      } else {
        inFinish = true;
        finishWords.push(w);
      }
    }
  }

  return {
    drill: drillWords.join(" ").trim(),
    finish: finishWords.join(" ").trim()
  };
}

export function normalizePartOrPanelName(name: string): string {
  let cleanName = name.replace(/\s+/g, " ").trim();

  // Replace LH+RH with LH/RH
  cleanName = cleanName.replace(/LH\+RH/gi, "LH/RH");

  // Remove SO suffix if present at the end, e.g. "-SO-00029"
  const soSuffixMatch = cleanName.match(/-SO-\d+(?:-\d+)?$/i);
  let soSuffix = "";
  if (soSuffixMatch) {
    soSuffix = soSuffixMatch[0];
    cleanName = cleanName.substring(0, cleanName.length - soSuffix.length).trim();
  }

  // Remove trailing "Project"
  if (cleanName.endsWith("-Project")) {
    cleanName = cleanName.substring(0, cleanName.length - 8).trim();
  } else if (cleanName.endsWith(" Project")) {
    cleanName = cleanName.substring(0, cleanName.length - 8).trim();
  }

  const isPart = /^(Part|Parts)\b/i.test(cleanName);
  const isPanel = /^(Panel|Panels)\b/i.test(cleanName);
  if (!isPart && !isPanel) {
    return (cleanName + soSuffix).replace(/\s+/g, " ").trim();
  }
  // Find dimensions or mm size
  const dimRegex = /\b\d+x\d+x\d+\b/;
  const dimMatch = cleanName.match(dimRegex);

  const mmRegex = /\b\d+mm\b/;
  const mmMatch = cleanName.match(mmRegex);

  const sizeIndicator = dimMatch ? dimMatch[0] : (mmMatch ? mmMatch[0] : "");
  if (!sizeIndicator) {
    return name;
  }

  const sizeIdx = cleanName.indexOf(sizeIndicator);
  let beforeSize = cleanName.substring(0, sizeIdx).trim();
  const afterSize = cleanName.substring(sizeIdx + sizeIndicator.length).trim();

  const { drill, finish } = splitDrillAndFinish(afterSize);

  // Normalize prefix
  let prefix = beforeSize;
  const isProfile = /\bProfile\b/i.test(beforeSize);

  if (isPart) {
    if (isProfile) {
      prefix = beforeSize.replace(/^(Parts|Part)[\s-]*(Profile)\b/i, "Part Profile").replace(/\s+/g, " ").trim();
    } else {
      prefix = beforeSize.replace(/^(Parts|Part)[\s-]*\b/i, "Part - ").replace(/\s+/g, " ").trim();
    }
  } else if (isPanel) {
    if (isProfile) {
      prefix = beforeSize.replace(/^(Panels|Panel)[\s-]*(Profile)\b/i, "Panel Profile").replace(/\s+/g, " ").trim();
    } else {
      prefix = beforeSize.replace(/^(Panels|Panel)[\s-]*\b/i, "Panel - ").replace(/\s+/g, " ").trim();
    }
  }

  // Extract side from drill or beforeSize
  const sideRegex = /LH\/RH|LHS|RHS/i;
  const singleSideRegex = /(?:^|\s)(LH|RH)(?:\s|$)/i;

  const prefixMatch = drill.match(/^(LH|RH)(?:\s+(.*))?$/i);
  let side: string | null = null;
  let actualDrill = drill;

  if (prefixMatch) {
    side = prefixMatch[1].toUpperCase();
    actualDrill = prefixMatch[2] ? prefixMatch[2].trim() : "";
  } else {
    if (!sideRegex.test(beforeSize)) {
      const nameMatch = beforeSize.match(singleSideRegex);
      if (nameMatch) {
        side = nameMatch[1].toUpperCase();
      }
    }
  }

  if (side) {
    prefix = prefix.replace(/LH\/RH|LH|RH|LHS|RHS/gi, side);

    if (isPart && actualDrill && actualDrill.toLowerCase() !== "no drill") {
      const prefixNoSide = prefix.replace(/(?:^|\s)(LH|RH)(?:\s|$)/gi, " ").replace(/\s+/g, " ").trim();
      const finalBase = `${prefixNoSide} ${side} ${actualDrill} ${sizeIndicator} ${finish}`
        .replace(/\s+/g, " ")
        .trim();
      return (finalBase + soSuffix).replace(/\s+/g, " ").trim();
    } else {
      const finalBase = `${prefix} ${sizeIndicator} ${finish}`
        .replace(/\s+/g, " ")
        .trim();
      return (finalBase + soSuffix).replace(/\s+/g, " ").trim();
    }
  } else {
    if (isPart && actualDrill && actualDrill.toLowerCase() !== "no drill") {
      const finalBase = `${prefix} ${sizeIndicator} ${actualDrill} ${finish}`
        .replace(/\s+/g, " ")
        .trim();
      return (finalBase + soSuffix).replace(/\s+/g, " ").trim();
    } else {
      const finalBase = `${prefix} ${sizeIndicator} ${finish}`
        .replace(/\s+/g, " ")
        .trim();
      return (finalBase + soSuffix).replace(/\s+/g, " ").trim();
    }
  }
}

export function getPartBaseName(pName: string, drill: string | null, finish: string): string {
  const cleanPName = pName.replace(/^Panels/i, "").trim();
  const rawName = `Part ${cleanPName} ${drill || ""} ${finish}`;
  return normalizePartOrPanelName(rawName);
}

export function getPanelBaseName(pName: string, drill: string | null, finish: string): string {
  const cleanPName = pName.replace(/^Panels/i, "").trim();
  const sidePrefix = drill ? (drill.trim().match(/^(LH|RH)\b/i) ? drill.trim().match(/^(LH|RH)\b/i)![0] + " " : "") : "";
  const rawName = `Panel ${cleanPName} ${sidePrefix}${finish}`;
  return normalizePartOrPanelName(rawName);
}

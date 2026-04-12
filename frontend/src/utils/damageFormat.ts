export function getKoClass(guaranteedKo: number): string {
  if (guaranteedKo === 1) return "dmg-ohko";
  if (guaranteedKo === 2) return "dmg-2hko";
  if (guaranteedKo === 3) return "dmg-3hko";
  return "dmg-weak";
}

export function getKoLabel(guaranteedKo: number, typeEff: number): string {
  if (typeEff === 0) return "無効";
  if (guaranteedKo <= 0) return "";
  if (guaranteedKo === 1) return "確1";
  return `確${guaranteedKo}`;
}

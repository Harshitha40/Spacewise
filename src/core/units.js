// Unit helpers. Internal representation is always metres.
export const M_PER_FT = 0.3048;
export const M_PER_IN = 0.0254;

export function roomUnit(sys) { return sys === 'imperial' ? 'ft' : 'm'; }
export function itemUnit(sys) { return sys === 'imperial' ? 'in' : 'cm'; }

export function toRoomUnit(m, sys) { return sys === 'imperial' ? m / M_PER_FT : m; }
export function fromRoomUnit(v, sys) { return sys === 'imperial' ? v * M_PER_FT : v; }
export function toItemUnit(m, sys) { return sys === 'imperial' ? m / M_PER_IN : m * 100; }
export function fromItemUnit(v, sys) { return sys === 'imperial' ? v * M_PER_IN : v / 100; }

export function fmtArea(m2, sys) {
  return sys === 'imperial' ? `${Math.round(m2 / (M_PER_FT * M_PER_FT))} sq ft` : `${m2.toFixed(1)} m²`;
}
export function fmtLen(m, sys) {
  if (sys === 'imperial') {
    const totalIn = Math.round(m / M_PER_IN);
    const ft = Math.floor(totalIn / 12), inch = totalIn % 12;
    return ft ? `${ft}′${inch ? ` ${inch}″` : ''}` : `${inch}″`;
  }
  return m >= 1 ? `${m.toFixed(2)} m` : `${Math.round(m * 100)} cm`;
}
export const round = (v, p = 2) => Math.round(v * 10 ** p) / 10 ** p;

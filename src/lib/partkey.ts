// Part-number normalization shared by the build (validation, index) and the
// browser (search, bulk paste). No dependencies.

// "OEM # 03187 A0897" -> "03187A0897"
export function oemKey(s: string) {
  return s
    .toUpperCase()
    .replace(/\b(OEM|P\/?N|PART|NO|NUMBER)\b\.?/g, ' ')
    .replace(/[^A-Z0-9]/g, '');
}

// "03187A0897" -> "3187A0897" (people drop the leading zero)
export const noLead0 = (k: string) => k.replace(/^0+/, '');

// Tolerate the letter O typed for zero.
export const o2zero = (k: string) => k.replace(/O/g, '0');

// The standard Hayssen format: 5 digits, 1 letter, 4 digits.
export const OEM_PATTERN = /^\d{5}[A-Z]\d{4}$/;

// "cm 2", "CM-0002", "cm#12" -> "CM-0002" / "CM-0012"; null if not a CM number.
export function cmKey(s: string) {
  const m = /^\s*cm[\s#-]*0*(\d{1,4})\s*$/i.exec(s);
  return m ? `CM-${m[1].padStart(4, '0')}` : null;
}

// Variants of a query key to compare against a part's keys.
export function queryVariants(q: string) {
  const k = oemKey(q);
  return [...new Set([k, noLead0(k), o2zero(k), noLead0(o2zero(k))])].filter(Boolean);
}

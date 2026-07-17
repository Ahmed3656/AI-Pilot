import { AppLocale } from '@/localization';

const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
const persianDigits = '۰۱۲۳۴۵۶۷۸۹';

export function toWesternDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(persianDigits.indexOf(digit)));
}

export function parseNumericInput(value: string): number | null {
  const normalized = toWesternDigits(value)
    .replace(/[٬,\s]/g, '')
    .replace('٫', '.');
  if (!normalized.trim()) return null;
  const parsed = Number(normalized.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatEGP(
  amount: string | number | null,
  locale: AppLocale,
): string {
  if (amount === null) return '— EGP';
  const numericAmount = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(numericAmount)) return '— EGP';
  const formatted = new Intl.NumberFormat(
    locale === 'ar-EG' ? 'ar-EG-u-nu-arab' : 'en-EG',
    { maximumFractionDigits: 2, minimumFractionDigits: 2 },
  ).format(numericAmount);
  return `\u2066${formatted} EGP\u2069`;
}

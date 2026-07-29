import { MessageKey } from '@/localization';
import { toWesternDigits } from './currency';
import { ShoppingCategory } from './types';

export interface ClarificationField {
  key: string;
  label: MessageKey;
  keyboardType?: 'default' | 'numeric';
}

export const clarificationFields: Record<
  ShoppingCategory,
  ClarificationField[]
> = {
  retail: [
    { key: 'product', label: 'fieldProduct' },
    { key: 'model', label: 'fieldModel' },
    { key: 'budget', label: 'fieldBudget', keyboardType: 'numeric' },
    { key: 'variant', label: 'fieldVariant' },
    { key: 'quantity', label: 'fieldQuantity', keyboardType: 'numeric' },
    { key: 'deliveryDeadline', label: 'fieldDeadline' },
  ],
  food: [
    { key: 'meal', label: 'fieldMeal' },
    { key: 'size', label: 'fieldSize' },
    { key: 'modifiers', label: 'fieldModifiers' },
    { key: 'minimumRating', label: 'fieldRating', keyboardType: 'numeric' },
    { key: 'budget', label: 'fieldBudget', keyboardType: 'numeric' },
    { key: 'area', label: 'fieldArea' },
    { key: 'deliveryPreference', label: 'fieldDelivery' },
  ],
  cinema: [
    { key: 'movie', label: 'fieldMovie' },
    { key: 'date', label: 'fieldDate' },
    { key: 'timeWindow', label: 'fieldTime' },
    { key: 'preferredArea', label: 'fieldArea' },
    { key: 'language', label: 'fieldLanguage' },
    { key: 'screenFormat', label: 'fieldFormat' },
    { key: 'seatCount', label: 'fieldSeats', keyboardType: 'numeric' },
    { key: 'adjacency', label: 'fieldAdjacency' },
    { key: 'seatType', label: 'fieldSeatType' },
  ],
};

const signals: Record<ShoppingCategory, string[]> = {
  retail: [
    'buy',
    'phone',
    'samsung',
    'galaxy',
    'iphone',
    'xiaomi',
    'oppo',
    'laptop',
    'amazon',
    'jumia',
    'noon',
    'product',
    'shop',
    'price',
    'deal',
    'shoes',
    'sneakers',
    'clothes',
    'headphones',
    'tablet',
    'television',
    'camera',
    'watch',
    'اشتري',
    'هاتف',
    'موبايل',
    'لابتوب',
    'منتج',
    'أمازون',
    'جوميا',
    'نون',
    'سعر',
    'عرض',
    'ملابس',
    'حذاء',
    'سماعات',
    'تابلت',
    'تلفزيون',
  ],
  food: [
    'food',
    'meal',
    'menu',
    'restaurant',
    'pizza',
    'burger',
    'talabat',
    'menu egypt',
    'menuegypt',
    'elmenus',
    'google maps',
    'delivery',
    'eat',
    'order',
    'lunch',
    'dinner',
    'breakfast',
    'chicken',
    'koshari',
    'koshary',
    'shawarma',
    'shawerma',
    'طعام',
    'وجبة',
    'مطعم',
    'بيتزا',
    'برجر',
    'طلبات',
    'أكل',
    'غداء',
    'عشاء',
    'فطار',
    'فراخ',
    'كشري',
    'شاورما',
  ],
  cinema: [
    'cinema',
    'movie',
    'film',
    'showtime',
    'seat',
    'vox',
    'ticket',
    'theater',
    'imax',
    'سينما',
    'فيلم',
    'عرض',
    'مقعد',
    'مقاعد',
    'فوكس',
    'تذكرة',
    'آيماكس',
  ],
};

const signalPatterns: Record<ShoppingCategory, RegExp[]> = {
  retail: [
    /\b(?:galaxy\s+)?[asmz]\s?\d{2,3}(?:\s*(?:5g|fe|ultra|plus))?\b/i,
    /\b\d{2,4}\s*(?:gb|gigabytes?)\b/i,
  ],
  food: [],
  cinema: [],
};

export function detectShoppingCategory(
  request: string,
): ShoppingCategory | null {
  const normalized = request.trim().toLocaleLowerCase();
  if (!normalized) return null;

  let bestCategory: ShoppingCategory | null = null;
  let bestMatches = 0;
  for (const category of Object.keys(signals) as ShoppingCategory[]) {
    const matches =
      signals[category].filter((signal) => normalized.includes(signal)).length +
      signalPatterns[category].filter((pattern) => pattern.test(normalized))
        .length;
    if (matches > bestMatches) {
      bestCategory = category;
      bestMatches = matches;
    }
  }
  return bestCategory;
}

export function compactClarification(
  values: Record<string, string>,
): Record<string, string> {
  const numericFields = new Set([
    'budget',
    'quantity',
    'minimumRating',
    'seatCount',
  ]);
  return Object.fromEntries(
    Object.entries(values)
      .map(([key, value]) => {
        const normalized = toWesternDigits(value.trim());
        return [
          key,
          numericFields.has(key)
            ? normalized.replace(/[٬,\s]/g, '').replace('٫', '.')
            : normalized,
        ];
      })
      .filter(([, value]) => Boolean(value)),
  );
}

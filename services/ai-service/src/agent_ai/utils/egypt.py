from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

_DIGIT_TRANSLATION = str.maketrans(
    "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹٫٬",
    "01234567890123456789.,",
)

LABELS: dict[str, tuple[str, ...]] = {
    "price": ("price", "السعر", "سعر"),
    "delivery_fee": ("delivery fee", "delivery", "رسوم التوصيل", "توصيل"),
    "service_fee": ("service fee", "رسوم الخدمة"),
    "discount": ("discount", "خصم", "التوفير"),
    "total": ("total", "order total", "الإجمالي", "المجموع"),
    "minimum_order": ("minimum order", "الحد الأدنى للطلب"),
    "delivery_estimate": ("delivery time", "estimated delivery", "وقت التوصيل"),
    "rating": ("rating", "التقييم"),
    "language": ("language", "اللغة"),
    "screen_format": ("screen format", "format", "نوع العرض", "صيغة العرض"),
    "booking_fee": ("booking fee", "رسوم الحجز"),
    "seat": ("seat", "seats", "مقعد", "مقاعد"),
    "stock": ("in stock", "available", "متوفر", "متاح"),
}

_GOVERNORATE_ALIASES: dict[str, tuple[str, ...]] = {
    "Cairo": ("cairo", "القاهرة", "قاهره"),
    "Giza": ("giza", "الجيزة", "جيزه"),
    "Alexandria": ("alexandria", "alex", "الإسكندرية", "اسكندرية"),
    "Dakahlia": ("dakahlia", "الدقهلية"),
    "Red Sea": ("red sea", "البحر الأحمر"),
    "Beheira": ("beheira", "البحيرة"),
    "Fayoum": ("fayoum", "faiyum", "الفيوم"),
    "Gharbia": ("gharbia", "الغربية"),
    "Ismailia": ("ismailia", "الإسماعيلية"),
    "Monufia": ("monufia", "menoufia", "المنوفية"),
    "Minya": ("minya", "المنيا"),
    "Qalyubia": ("qalyubia", "القليوبية"),
    "New Valley": ("new valley", "الوادي الجديد"),
    "Suez": ("suez", "السويس"),
    "Aswan": ("aswan", "أسوان"),
    "Assiut": ("assiut", "asyut", "أسيوط"),
    "Beni Suef": ("beni suef", "بني سويف"),
    "Port Said": ("port said", "بورسعيد"),
    "Damietta": ("damietta", "دمياط"),
    "Sharqia": ("sharqia", "الشرقية"),
    "South Sinai": ("south sinai", "جنوب سيناء"),
    "Kafr El Sheikh": ("kafr el sheikh", "كفر الشيخ"),
    "Matrouh": ("matrouh", "مطروح"),
    "Luxor": ("luxor", "الأقصر"),
    "Qena": ("qena", "قنا"),
    "North Sinai": ("north sinai", "شمال سيناء"),
    "Sohag": ("sohag", "سوهاج"),
}

_CAIRO_AREA_ALIASES: dict[str, tuple[str, ...]] = {
    "Nasr City": ("nasr city", "مدينة نصر"),
    "Heliopolis": ("heliopolis", "مصر الجديدة"),
    "New Cairo": ("new cairo", "القاهرة الجديدة", "التجمع"),
    "Maadi": ("maadi", "المعادي"),
    "Zamalek": ("zamalek", "الزمالك"),
    "Downtown Cairo": ("downtown cairo", "وسط البلد"),
    "Shorouk": ("shorouk", "الشروق"),
    "Obour": ("obour", "العبور"),
    "Mokattam": ("mokattam", "المقطم"),
    "Dokki": ("dokki", "الدقي"),
    "Mohandessin": ("mohandessin", "المهندسين"),
    "6th of October": ("6th of october", "6 october", "السادس من أكتوبر", "٦ أكتوبر"),
    "Sheikh Zayed": ("sheikh zayed", "الشيخ زايد"),
    "Haram": ("haram", "الهرم"),
}

_GIZA_AREAS = {"Dokki", "Mohandessin", "6th of October", "Sheikh Zayed", "Haram"}


@dataclass(frozen=True, slots=True)
class NormalizedLocation:
    governorate: str | None
    area: str | None
    original: str


def normalize_digits(value: str) -> str:
    """Normalize Arabic-Indic/Persian digits and Arabic numeric separators."""
    return value.translate(_DIGIT_TRANSLATION)


def parse_egp(value: str | int | float | Decimal) -> Decimal:
    if isinstance(value, Decimal):
        return value
    if isinstance(value, int | float):
        return Decimal(str(value))
    normalized = normalize_digits(value).strip()
    match = re.search(r"[-+]?\d[\d\s,.]*", normalized)
    if not match:
        raise ValueError(f"No EGP amount found in {value!r}")
    number = re.sub(r"\s+", "", match.group())
    if "," in number and "." in number:
        number = number.replace(",", "")
    elif "," in number:
        tail = number.rsplit(",", 1)[1]
        number = number.replace(",", "." if len(tail) in {1, 2} else "")
    try:
        return Decimal(number)
    except InvalidOperation as exc:
        raise ValueError(f"Invalid EGP amount: {value!r}") from exc


def normalize_label(value: str) -> str | None:
    folded = " ".join(value.casefold().split())
    for canonical, aliases in LABELS.items():
        if any(alias.casefold() in folded for alias in aliases):
            return canonical
    return None


def _find_alias(value: str, mapping: dict[str, tuple[str, ...]]) -> str | None:
    folded = normalize_digits(value).casefold()
    for canonical, aliases in mapping.items():
        if any(normalize_digits(alias).casefold() in folded for alias in aliases):
            return canonical
    return None


def normalize_location(value: str) -> NormalizedLocation:
    """Normalize only location names that the caller supplied; never synthesize an address."""
    area = _find_alias(value, _CAIRO_AREA_ALIASES)
    governorate = _find_alias(value, _GOVERNORATE_ALIASES)
    if governorate is None and area is not None:
        governorate = "Giza" if area in _GIZA_AREAS else "Cairo"
    return NormalizedLocation(governorate=governorate, area=area, original=value)

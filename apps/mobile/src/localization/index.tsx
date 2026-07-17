import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { TextStyle, ViewStyle } from 'react-native';
import { STORAGE_KEYS } from '@/constants/storage';
import { storage } from '@/storage/storage';

export type AppLocale = 'en' | 'ar';

const en = {
  appName: 'DealPilot',
  homeTitle: 'What can I find for you?',
  homeSubtitle:
    'Describe what you need. DealPilot checks Egyptian merchants and asks before any sensitive action.',
  egyptMarket: 'Egypt market',
  egyptOnly: 'Egypt only · prices in EGP',
  english: 'EN',
  arabic: 'ع',
  requestLabel: 'Your request',
  requestPlaceholder: 'e.g. Find a 256 GB phone under 30,000 EGP',
  examplesTitle: 'Try an example',
  categoryTitle: 'Category',
  auto: 'Auto-detect',
  retail: 'Retail',
  food: 'Food',
  cinema: 'Cinema',
  detectedCategory: 'Detected category',
  clarificationTitle: 'A few useful details',
  optionalHint: 'Optional — add only what matters to you.',
  startRun: 'Start checking options',
  startingRun: 'Starting…',
  addressProfile: 'Egypt delivery address',
  addressProfileHint:
    'Stored securely on this phone and shared only with consent.',
  editAddress: 'Add or edit address',
  edit: 'Edit',
  deliveryAddress: 'Delivery address',
  savedAddresses: 'Saved addresses',
  defaultAddress: 'Default address',
  defaultAddressChanged: 'Default delivery address updated.',
  defaultBadge: 'Default',
  makeDefault: 'Use as default',
  addNewAddress: 'Add another address',
  noSavedAddresses: 'No saved address yet',
  addressLabel: 'Address label',
  addressLabelPlaceholder: 'e.g. Home or Work',
  addressSelectionFailed: 'Could not change the default address.',
  viewSettings: 'Settings',
  account: 'Account',
  guest: 'Guest',
  guestHint:
    'Authentication is not required yet. You can use DealPilot normally.',
  authWelcome: 'Welcome to DealPilot',
  authSubtitle: 'Your personal shopping agent for verified deals across Egypt.',
  authPreviewHint:
    'Preview mode — your details stay on this screen and are not authenticated or saved.',
  login: 'Log in',
  createAccount: 'Create account',
  displayName: 'Name',
  email: 'Email',
  password: 'Password',
  authPasswordHint: 'Use at least 8 characters.',
  authWorking: 'Please wait…',
  authInvalidEmail: 'Enter a valid email address.',
  authPasswordTooShort: 'Password must contain at least 8 characters.',
  authNameRequired: 'Enter your name.',
  authFailed: 'Those details did not work. Check them and try again.',
  authUnavailable: 'Authentication is unavailable right now. Try again soon.',
  needAccount: 'New to DealPilot?',
  haveAccount: 'Already have an account?',
  signOut: 'Sign out',
  settingsTitle: 'Settings',
  themeLabel: 'Appearance',
  light: 'Light',
  dark: 'Dark',
  system: 'System',
  preferencesHint:
    'Your profile and preferences stay linked to your signed-in account.',
  requestRequired: 'Enter a request to continue.',
  categoryRequired: 'Choose a category so DealPilot knows what to check.',
  autoWillDetect: 'DealPilot will detect the category when you send.',
  addDetails: 'Add preferences',
  hideDetails: 'Hide preferences',
  sendRequest: 'Send request',
  startFailed: 'Could not start this run. Check the connection and try again.',
  exampleRetail:
    'Find a Samsung A55 256 GB under 25,000 EGP, delivered by Thursday',
  exampleFood:
    'Order a large pepperoni pizza in Maadi, rated 4.3+, under 450 EGP',
  exampleCinema:
    'Find two adjacent VOX seats for an English movie Friday after 7 pm',
  fieldProduct: 'Product',
  fieldModel: 'Model',
  fieldBudget: 'Budget (EGP)',
  fieldVariant: 'Size / color / storage',
  fieldQuantity: 'Quantity',
  fieldDeadline: 'Delivery deadline',
  fieldMeal: 'Meal',
  fieldSize: 'Size',
  fieldModifiers: 'Modifiers',
  fieldRating: 'Minimum rating',
  fieldArea: 'Area',
  fieldDelivery: 'Delivery preference',
  fieldMovie: 'Movie',
  fieldDate: 'Date',
  fieldTime: 'Time window',
  fieldLanguage: 'Language',
  fieldFormat: 'Screen format',
  fieldSeats: 'Seat count',
  fieldAdjacency: 'Adjacency',
  fieldSeatType: 'Seat type',
  addressTitle: 'Egypt address profile',
  addressSubtitle:
    'This profile stays in SecureStore on your physical phone. DealPilot never logs it.',
  recipientName: 'Recipient name',
  mobileNumber: 'Egyptian mobile number',
  governorate: 'Governorate',
  cityArea: 'City / area',
  street: 'Street',
  building: 'Building',
  floor: 'Floor',
  apartment: 'Apartment',
  landmark: 'Landmark',
  postalCode: 'Postal code (optional)',
  requiredField: 'Required',
  invalidMobile: 'Use an Egyptian mobile number such as 01012345678.',
  saveAddress: 'Save securely',
  savingAddress: 'Saving…',
  addressSaved: 'Address saved securely on this phone.',
  addressSaveFailed: 'Could not save the address securely.',
  addressWebNotice:
    'Browser preview keeps this profile only for the current session. SecureStore is used on physical phones.',
  runTitle: 'Live deal run',
  runSubtitle: 'Follow every checked option and step in real time.',
  queued: 'Queued',
  running: 'Running',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
  failed: 'Failed',
  connectionLive: 'Live',
  connectionConnecting: 'Connecting',
  connectionReconnecting: 'Reconnecting',
  connectionPolling: 'Polling fallback',
  connectionOffline: 'Offline',
  pause: 'Pause',
  resume: 'Resume',
  cancel: 'Cancel run',
  runActionFailed: 'The run action did not reach the server. Try again.',
  runLoadFailed:
    'Live updates are temporarily unavailable. Polling will keep trying.',
  timeline: 'Event timeline',
  noEvents: 'Waiting for the first update…',
  warnings: 'Warnings',
  partialResults: 'Partial results',
  screenshots: 'Screenshots',
  approvals: 'Your approval is needed',
  merchantApproval: 'Merchant approval',
  merchantApprovalBody:
    'Approve before DealPilot continues with this merchant.',
  addressConsent: 'Address-sharing consent',
  addressConsentPrefix: 'Only this merchant will receive your saved address:',
  addressConsentBody:
    'The address is loaded only after you approve and its temporary copy is cleared after transmission.',
  seatHoldApproval: 'Seat-hold approval',
  seatHoldBody: 'Approve this temporary seat hold before it expires.',
  approve: 'Approve',
  decline: 'Decline',
  approving: 'Sending…',
  addressMissing: 'Save an address profile before approving address sharing.',
  approvalFailed: 'Could not send this decision. Try again.',
  couponAttempt: 'Coupon attempt',
  couponApplied: 'Applied',
  couponRejected: 'Not applied',
  couponTrying: 'Trying',
  openReport: 'View checked options',
  remoteViewer: 'Remote browser',
  remoteViewerSubtitle:
    'View-only while DealPilot works. Take over only when the agent asks for help.',
  viewerUnavailable:
    'The remote browser will appear when the agent opens a merchant.',
  takeOver: 'Take over',
  takingOver: 'Requesting control…',
  releaseControl: 'Release to DealPilot',
  controlActive: 'You are controlling this browser.',
  viewOnly: 'View-only · AI working',
  controlFailed: 'Could not get a control token. Try again.',
  releaseFailed: 'Could not release control. Try again.',
  paymentWarningTitle: 'Manual payment only',
  paymentWarning:
    'Never send card details, OTPs, PINs, or wallet codes to DealPilot. Enter payment details yourself only while you have control.',
  reportTitle: 'Checked options',
  reportSubtitle:
    'Totals are compared only when every required charge was verified.',
  lowestVerified: 'Lowest verified total among checked options',
  noVerifiedTotal: 'No checked option has a fully verified total yet.',
  subtotal: 'Items',
  delivery: 'Delivery',
  serviceFee: 'Service fee',
  taxes: 'Taxes',
  discount: 'Discount',
  total: 'Verified total',
  incompleteReason: 'Incomplete reason',
  completeReason: 'None — total verified',
  unavailableReason: 'Merchant has not returned a complete option.',
  verifiedAt: 'Verified',
  rating: 'Rating',
  showtime: 'Showtime',
  venue: 'Venue',
  candidate: 'Candidate',
  reportLoadFailed:
    'Could not load the latest report. Pull back and try again.',
  close: 'Close',
} as const;

const ar: Record<keyof typeof en, string> = {
  appName: 'ديل بايلوت',
  homeTitle: 'ما الذي تبحث عنه؟',
  homeSubtitle:
    'اكتب طلبك وسيتحقق ديل بايلوت من المتاجر المصرية، وسيطلب موافقتك قبل أي خطوة حساسة.',
  egyptMarket: 'سوق مصر',
  egyptOnly: 'مصر فقط · الأسعار بالجنيه المصري EGP',
  english: 'EN',
  arabic: 'ع',
  requestLabel: 'طلبك',
  requestPlaceholder: 'مثال: ابحث عن هاتف ٢٥٦ جيجابايت بأقل من ٣٠٬٠٠٠ EGP',
  examplesTitle: 'جرّب مثالاً',
  categoryTitle: 'الفئة',
  auto: 'تحديد تلقائي',
  retail: 'تسوّق',
  food: 'طعام',
  cinema: 'سينما',
  detectedCategory: 'الفئة المتوقعة',
  clarificationTitle: 'بعض التفاصيل المفيدة',
  optionalHint: 'اختياري — أضف ما يهمك فقط.',
  startRun: 'ابدأ التحقق من الخيارات',
  startingRun: 'جارٍ البدء…',
  addressProfile: 'عنوان التوصيل داخل مصر',
  addressProfileHint: 'محفوظ بأمان على هذا الهاتف ولا يُشارك إلا بموافقتك.',
  editAddress: 'إضافة أو تعديل العنوان',
  edit: 'تعديل',
  deliveryAddress: 'عنوان التوصيل',
  savedAddresses: 'العناوين المحفوظة',
  defaultAddress: 'العنوان الافتراضي',
  defaultAddressChanged: 'تم تحديث عنوان التوصيل الافتراضي.',
  defaultBadge: 'افتراضي',
  makeDefault: 'استخدام كعنوان افتراضي',
  addNewAddress: 'إضافة عنوان آخر',
  noSavedAddresses: 'لا يوجد عنوان محفوظ بعد',
  addressLabel: 'اسم العنوان',
  addressLabelPlaceholder: 'مثال: المنزل أو العمل',
  addressSelectionFailed: 'تعذر تغيير العنوان الافتراضي.',
  viewSettings: 'الإعدادات',
  account: 'الحساب',
  guest: 'زائر',
  guestHint:
    'تسجيل الدخول غير مطلوب حالياً. يمكنك استخدام ديل بايلوت بشكل طبيعي.',
  authWelcome: 'مرحباً بك في ديل بايلوت',
  authSubtitle: 'مساعدك الشخصي للعثور على عروض موثّقة داخل مصر.',
  authPreviewHint:
    'وضع المعاينة — تبقى بياناتك في هذه الشاشة ولا يتم تسجيلها أو حفظها.',
  login: 'تسجيل الدخول',
  createAccount: 'إنشاء حساب',
  displayName: 'الاسم',
  email: 'البريد الإلكتروني',
  password: 'كلمة المرور',
  authPasswordHint: 'استخدم ٨ أحرف على الأقل.',
  authWorking: 'يرجى الانتظار…',
  authInvalidEmail: 'أدخل بريداً إلكترونياً صحيحاً.',
  authPasswordTooShort: 'يجب أن تتكون كلمة المرور من ٨ أحرف على الأقل.',
  authNameRequired: 'أدخل اسمك.',
  authFailed: 'تعذر استخدام هذه البيانات. راجعها وحاول مرة أخرى.',
  authUnavailable: 'خدمة تسجيل الدخول غير متاحة الآن. حاول لاحقاً.',
  needAccount: 'جديد في ديل بايلوت؟',
  haveAccount: 'لديك حساب بالفعل؟',
  signOut: 'تسجيل الخروج',
  settingsTitle: 'الإعدادات',
  themeLabel: 'المظهر',
  light: 'فاتح',
  dark: 'داكن',
  system: 'حسب النظام',
  preferencesHint: 'ملفك وتفضيلاتك مرتبطان بحسابك المسجل.',
  requestRequired: 'اكتب طلباً للمتابعة.',
  categoryRequired: 'اختر فئة ليعرف ديل بايلوت أين يبحث.',
  autoWillDetect: 'سيحدد ديل بايلوت الفئة عند إرسال الطلب.',
  addDetails: 'إضافة التفضيلات',
  hideDetails: 'إخفاء التفضيلات',
  sendRequest: 'إرسال الطلب',
  startFailed: 'تعذر بدء المهمة. تحقق من الاتصال وحاول مرة أخرى.',
  exampleRetail:
    'ابحث عن Samsung A55 سعة ٢٥٦ جيجابايت بأقل من ٢٥٬٠٠٠ EGP والتوصيل قبل الخميس',
  exampleFood: 'اطلب بيتزا ببروني كبيرة في المعادي بتقييم +٤٫٣ وأقل من ٤٥٠ EGP',
  exampleCinema:
    'ابحث عن مقعدين متجاورين في VOX لفيلم إنجليزي الجمعة بعد ٧ مساءً',
  fieldProduct: 'المنتج',
  fieldModel: 'الموديل',
  fieldBudget: 'الميزانية (EGP)',
  fieldVariant: 'المقاس / اللون / السعة',
  fieldQuantity: 'الكمية',
  fieldDeadline: 'موعد التوصيل',
  fieldMeal: 'الوجبة',
  fieldSize: 'الحجم',
  fieldModifiers: 'التعديلات',
  fieldRating: 'الحد الأدنى للتقييم',
  fieldArea: 'المنطقة',
  fieldDelivery: 'تفضيل التوصيل',
  fieldMovie: 'الفيلم',
  fieldDate: 'التاريخ',
  fieldTime: 'الفترة الزمنية',
  fieldLanguage: 'اللغة',
  fieldFormat: 'صيغة الشاشة',
  fieldSeats: 'عدد المقاعد',
  fieldAdjacency: 'تجاور المقاعد',
  fieldSeatType: 'نوع المقعد',
  addressTitle: 'ملف العنوان المصري',
  addressSubtitle:
    'يبقى هذا الملف داخل SecureStore على هاتفك. لا يسجله ديل بايلوت مطلقاً.',
  recipientName: 'اسم المستلم',
  mobileNumber: 'رقم الموبايل المصري',
  governorate: 'المحافظة',
  cityArea: 'المدينة / المنطقة',
  street: 'الشارع',
  building: 'المبنى',
  floor: 'الدور',
  apartment: 'الشقة',
  landmark: 'علامة مميزة',
  postalCode: 'الرمز البريدي (اختياري)',
  requiredField: 'مطلوب',
  invalidMobile: 'استخدم رقم موبايل مصرياً مثل 01012345678.',
  saveAddress: 'حفظ بأمان',
  savingAddress: 'جارٍ الحفظ…',
  addressSaved: 'تم حفظ العنوان بأمان على هذا الهاتف.',
  addressSaveFailed: 'تعذر حفظ العنوان بأمان.',
  addressWebNotice:
    'تحتفظ معاينة المتصفح بالملف خلال هذه الجلسة فقط. يُستخدم SecureStore على الهواتف الفعلية.',
  runTitle: 'مهمة البحث المباشرة',
  runSubtitle: 'تابع كل خيار وخطوة لحظة بلحظة.',
  queued: 'في قائمة الانتظار',
  running: 'قيد التشغيل',
  paused: 'متوقف مؤقتاً',
  completed: 'مكتمل',
  cancelled: 'ملغى',
  failed: 'فشل',
  connectionLive: 'مباشر',
  connectionConnecting: 'جارٍ الاتصال',
  connectionReconnecting: 'إعادة الاتصال',
  connectionPolling: 'تحديث احتياطي',
  connectionOffline: 'غير متصل',
  pause: 'إيقاف مؤقت',
  resume: 'استئناف',
  cancel: 'إلغاء المهمة',
  runActionFailed: 'لم يصل الأمر إلى الخادم. حاول مرة أخرى.',
  runLoadFailed:
    'التحديثات المباشرة غير متاحة مؤقتاً. سيستمر التحديث الاحتياطي في المحاولة.',
  timeline: 'الخط الزمني للأحداث',
  noEvents: 'في انتظار أول تحديث…',
  warnings: 'تحذيرات',
  partialResults: 'نتائج جزئية',
  screenshots: 'لقطات الشاشة',
  approvals: 'موافقتك مطلوبة',
  merchantApproval: 'الموافقة على التاجر',
  merchantApprovalBody: 'وافق قبل أن يتابع ديل بايلوت مع هذا التاجر.',
  addressConsent: 'الموافقة على مشاركة العنوان',
  addressConsentPrefix: 'هذا التاجر فقط سيستلم عنوانك المحفوظ:',
  addressConsentBody:
    'لا يُحمّل العنوان إلا بعد موافقتك، وتُمسح نسخته المؤقتة بعد الإرسال.',
  seatHoldApproval: 'الموافقة على حجز المقاعد مؤقتاً',
  seatHoldBody: 'وافق على حجز المقاعد المؤقت قبل انتهاء المهلة.',
  approve: 'موافقة',
  decline: 'رفض',
  approving: 'جارٍ الإرسال…',
  addressMissing: 'احفظ ملف العنوان قبل الموافقة على مشاركته.',
  approvalFailed: 'تعذر إرسال القرار. حاول مرة أخرى.',
  couponAttempt: 'محاولة الكوبون',
  couponApplied: 'تم التطبيق',
  couponRejected: 'لم يُطبّق',
  couponTrying: 'جارٍ التجربة',
  openReport: 'عرض الخيارات المفحوصة',
  remoteViewer: 'المتصفح البعيد',
  remoteViewerSubtitle:
    'للمشاهدة فقط أثناء عمل ديل بايلوت. استلم التحكم عندما يطلب المساعد تدخلك.',
  viewerUnavailable: 'سيظهر المتصفح البعيد عندما يفتح المساعد أحد المتاجر.',
  takeOver: 'استلام التحكم',
  takingOver: 'جارٍ طلب التحكم…',
  releaseControl: 'إعادة التحكم إلى ديل بايلوت',
  controlActive: 'أنت تتحكم في هذا المتصفح.',
  viewOnly: 'للمشاهدة فقط · المساعد يعمل',
  controlFailed: 'تعذر الحصول على رمز التحكم. حاول مرة أخرى.',
  releaseFailed: 'تعذر إعادة التحكم. حاول مرة أخرى.',
  paymentWarningTitle: 'الدفع يدوياً فقط',
  paymentWarning:
    'لا ترسل بيانات البطاقة أو رمز OTP أو PIN أو أكواد المحفظة إلى ديل بايلوت. أدخل بيانات الدفع بنفسك فقط أثناء تحكمك.',
  reportTitle: 'الخيارات المفحوصة',
  reportSubtitle: 'تُقارن الإجماليات فقط بعد التحقق من كل الرسوم المطلوبة.',
  lowestVerified: 'أقل إجمالي موثّق بين الخيارات المفحوصة',
  noVerifiedTotal: 'لا يوجد بعد خيار مفحوص بإجمالي موثّق بالكامل.',
  subtotal: 'العناصر',
  delivery: 'التوصيل',
  serviceFee: 'رسوم الخدمة',
  taxes: 'الضرائب',
  discount: 'الخصم',
  total: 'الإجمالي الموثّق',
  incompleteReason: 'سبب عدم الاكتمال',
  completeReason: 'لا يوجد — الإجمالي موثّق',
  unavailableReason: 'لم يُرجع التاجر خياراً مكتملاً.',
  verifiedAt: 'تم التحقق',
  rating: 'التقييم',
  showtime: 'موعد العرض',
  venue: 'السينما',
  candidate: 'الخيار',
  reportLoadFailed: 'تعذر تحميل أحدث تقرير. ارجع وحاول مرة أخرى.',
  close: 'إغلاق',
};

export const messages = { en, ar } as const;
export const defaultLocale: AppLocale = 'en';
export type MessageKey = keyof typeof en;

interface LocalizationContextValue {
  locale: AppLocale;
  isRTL: boolean;
  setLocale: (locale: AppLocale) => void;
  t: (key: MessageKey) => string;
  textDirection: Pick<TextStyle, 'textAlign' | 'writingDirection'>;
  rowDirection: Pick<ViewStyle, 'flexDirection'>;
}

const LocalizationContext = createContext<LocalizationContextValue | null>(
  null,
);

export function LocalizationProvider({ children }: PropsWithChildren) {
  const [locale, setLocaleState] = useState<AppLocale>(defaultLocale);
  useEffect(() => {
    storage
      .get(STORAGE_KEYS.locale)
      .then((savedLocale) => {
        if (savedLocale === 'en' || savedLocale === 'ar') {
          setLocaleState(savedLocale);
        }
      })
      .catch(() => undefined);
  }, []);
  const setLocale = useCallback((nextLocale: AppLocale) => {
    setLocaleState(nextLocale);
    void storage.set(STORAGE_KEYS.locale, nextLocale).catch(() => undefined);
  }, []);
  const value = useMemo<LocalizationContextValue>(() => {
    const isRTL = locale === 'ar';
    return {
      locale,
      isRTL,
      setLocale,
      t: (key) => messages[locale][key],
      textDirection: {
        textAlign: isRTL ? 'right' : 'left',
        writingDirection: isRTL ? 'rtl' : 'ltr',
      },
      rowDirection: { flexDirection: isRTL ? 'row-reverse' : 'row' },
    };
  }, [locale, setLocale]);

  return (
    <LocalizationContext.Provider value={value}>
      {children}
    </LocalizationContext.Provider>
  );
}

export function useLocalization() {
  const value = useContext(LocalizationContext);
  if (!value) {
    throw new Error('useLocalization must be used inside LocalizationProvider');
  }
  return value;
}

import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { router } from 'expo-router';
import { ShoppingHomeScreen } from './ShoppingHomeScreen';
import {
  createShoppingRun,
  replaceActiveShoppingRun,
} from '../shopping.service';
import { RunResource } from '../types';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
}));
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', displayName: 'Test User' } }),
}));
jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        background: '#fff',
        surface: '#f8f8f8',
        text: '#111',
        muted: '#666',
        primary: '#3355ff',
        primaryText: '#fff',
        border: '#ddd',
      },
    },
  }),
}));
jest.mock('@/localization', () => ({
  useLocalization: () => ({
    locale: 'en-EG',
    t: (key: string) => key,
    textDirection: { textAlign: 'left', writingDirection: 'ltr' },
    rowDirection: { flexDirection: 'row' },
  }),
}));
jest.mock('@/components/Toast', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));
jest.mock('@/components', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Pressable, Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    AppButton: ({
      disabled,
      label,
      onPress,
    }: {
      disabled?: boolean;
      label: string;
      onPress: () => void;
    }) =>
      React.createElement(
        Pressable,
        { disabled, onPress },
        React.createElement(Text, null, label),
      ),
  };
});
jest.mock('../components/ShoppingControls', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Pressable, Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    ChoiceChip: ({ label, onPress }: { label: string; onPress: () => void }) =>
      React.createElement(
        Pressable,
        { onPress },
        React.createElement(Text, null, label),
      ),
  };
});
jest.mock('../address', () => ({
  loadEgyptAddressBook: jest.fn().mockResolvedValue({
    addresses: [],
    defaultAddressId: null,
  }),
}));
jest.mock('../shopping.service', () => {
  const actual = jest.requireActual('../shopping.service');
  return {
    ...actual,
    createShoppingRun: jest.fn(),
    replaceActiveShoppingRun: jest.fn(),
  };
});

const createRun = createShoppingRun as jest.MockedFunction<
  typeof createShoppingRun
>;
const replaceRun = replaceActiveShoppingRun as jest.MockedFunction<
  typeof replaceActiveShoppingRun
>;
const push = router.push as jest.Mock;

const run: RunResource = {
  id: 'run-01',
  requestedCategory: 'auto',
  category: 'retail',
  market: 'EG',
  currency: 'EGP',
  timezone: 'Africa/Cairo',
  locale: 'en-EG',
  query: 'Find a phone',
  status: 'discovering',
  resumeStatus: null,
  pendingAction: null,
  failure: null,
  createdAt: '2026-07-18T09:00:00.000Z',
  updatedAt: '2026-07-18T09:00:00.000Z',
  completedAt: null,
  browserExpiresAt: '2026-07-18T10:00:00.000Z',
  lastEventId: null,
};

beforeEach(() => jest.clearAllMocks());

describe('shopping home active-run recovery', () => {
  it('offers to continue or replace a run after returning without cancelling', async () => {
    createRun.mockResolvedValueOnce(run);
    replaceRun.mockResolvedValueOnce({ ...run, id: 'run-02' });
    render(<ShoppingHomeScreen />);

    fireEvent.changeText(screen.getByLabelText('requestLabel'), 'Find a phone');
    fireEvent.press(screen.getByLabelText('sendRequest'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/run/run-01'));

    fireEvent.changeText(
      screen.getByLabelText('requestLabel'),
      'Find a laptop',
    );
    fireEvent.press(screen.getByLabelText('sendRequest'));

    expect(createRun).toHaveBeenCalledTimes(1);
    expect(screen.getByText('activeRunTitle')).toBeTruthy();
    expect(screen.getByText('continueActiveRun')).toBeTruthy();

    fireEvent.press(screen.getByText('cancelAndStartRun'));
    await waitFor(() =>
      expect(replaceRun).toHaveBeenCalledWith('run-01', {
        category: 'auto',
        locale: 'en-EG',
        query: 'Find a laptop',
      }),
    );
    expect(push).toHaveBeenLastCalledWith('/run/run-02');
  }, 20_000);
});

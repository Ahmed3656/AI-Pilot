import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { useQuery } from '@tanstack/react-query';
import { TextInput } from 'react-native';
import { ApprovalCard } from './components/ApprovalCard';
import { CandidateCard } from './components/CandidateCard';
import { RemoteBrowser } from './components/RemoteBrowser';
import { EvidenceGallery, RunTimeline } from './components/RunTimeline';
import { ShoppingReportScreen } from './screens/ShoppingReportScreen';
import {
  claimControl,
  createViewerToken,
  releaseControl,
} from './shopping.service';
import { OfferReport, RunReport, RunResource } from './types';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'run-ui' }),
}));
jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
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
        success: '#087',
        warning: '#a60',
        warningSurface: '#fff5dd',
        danger: '#c00',
      },
    },
  }),
}));
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ accessToken: null }),
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
jest.mock('react-native-webview', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    WebView: (props: Record<string, unknown>) =>
      React.createElement(View, { ...props, testID: 'webview' }),
  };
});
jest.mock('./shopping.service', () => ({
  claimControl: jest.fn(),
  createViewerToken: jest.fn(),
  getShoppingReport: jest.fn(),
  releaseControl: jest.fn(),
  renewControl: jest.fn(),
}));

const claim = claimControl as jest.MockedFunction<typeof claimControl>;
const viewerToken = createViewerToken as jest.MockedFunction<
  typeof createViewerToken
>;
const release = releaseControl as jest.MockedFunction<typeof releaseControl>;
const query = useQuery as jest.Mock;

const run: RunResource = {
  id: 'run-ui',
  requestedCategory: 'retail',
  category: 'retail',
  market: 'EG',
  currency: 'EGP',
  timezone: 'Africa/Cairo',
  locale: 'en-EG',
  query: 'test query',
  status: 'ready_for_handoff',
  resumeStatus: null,
  pendingAction: { type: 'handoff', requestId: 'handoff-1' },
  failure: null,
  createdAt: '2026-07-17T12:00:00.000Z',
  updatedAt: '2026-07-17T12:10:00.000Z',
  completedAt: null,
  browserExpiresAt: '2099-07-17T13:00:00.000Z',
  lastEventId: null,
};

const baseOffer: OfferReport = {
  id: 'offer-1',
  merchantAttemptId: 'attempt-1',
  category: 'retail',
  merchantName: 'Amazon Egypt',
  merchantDomain: 'amazon.eg',
  title: 'Samsung A55 256 GB',
  sourceUrl: 'https://amazon.eg/example',
  match: {
    exact: true,
    confidence: 0.99,
    explanation: 'Exact requested model.',
  },
  availability: 'available',
  details: {
    kind: 'retail',
    brand: 'Samsung',
    model: 'A55',
    variant: '256 GB',
    storage: '256 GB',
    size: null,
    color: 'Navy',
    quantity: 1,
    condition: 'new',
    deliveryEstimate: 'Tomorrow',
  },
  price: {
    itemSubtotal: '20000.00',
    deliveryFee: '50.00',
    serviceFee: '0.00',
    bookingFee: '0.00',
    tax: '0.00',
    mandatoryFees: [],
    verifiedDiscount: '500.00',
    optionalTip: null,
    finalTotal: '19550.00',
  },
  observedAt: '2026-07-17T12:05:00.000Z',
  evidenceIds: ['evidence-price'],
  exclusionReason: null,
  incompleteFields: [],
};

beforeEach(() => jest.clearAllMocks());

describe('shopping UI flows', () => {
  it.each([
    ['retail', baseOffer, 'Samsung A55'],
    [
      'food',
      {
        ...baseOffer,
        id: 'offer-food',
        category: 'food' as const,
        merchantName: 'Talabat Egypt',
        merchantDomain: 'talabat.com',
        title: 'Large pepperoni pizza',
        details: {
          kind: 'food' as const,
          restaurant: 'Test Pizza',
          meal: 'Pepperoni pizza',
          size: 'Large',
          modifiers: ['Extra cheese'],
          rating: 4.5,
          minimumOrder: '150.00',
          deliveryEstimate: '35 min',
          optionalTipExcluded: true as const,
        },
        price: {
          ...baseOffer.price,
          optionalTip: '0.00' as const,
        },
      },
      'Test Pizza',
    ],
    [
      'cinema',
      {
        ...baseOffer,
        id: 'offer-cinema',
        category: 'cinema' as const,
        merchantName: 'VOX Egypt',
        merchantDomain: 'voxcinemas.com',
        title: 'Two standard seats',
        details: {
          kind: 'cinema' as const,
          movie: 'Test Movie',
          venue: 'VOX City Centre Almaza',
          date: '2026-07-18',
          showtime: '2026-07-18T18:00:00.000Z',
          language: 'English',
          screenFormat: 'Standard',
          seatCount: 2,
          adjacentSeats: true,
          seatType: 'Standard',
          holdExpiresAt: null,
        },
      },
      'VOX City Centre Almaza',
    ],
  ])(
    'renders the real %s offer details and price breakdown',
    (_kind, offer, expected) => {
      render(
        <CandidateCard
          isWinner
          offer={offer as OfferReport}
          validity="valid"
        />,
      );

      expect(screen.getAllByText(new RegExp(expected)).length).toBeGreaterThan(
        0,
      );
      expect(screen.getByText(/19,550\.00 EGP/)).toBeTruthy();
      expect(screen.getByText(/evidence-price/)).toBeTruthy();
    },
  );

  it('submits server-provided clarification questions', () => {
    const onClarification = jest.fn();
    const view = render(
      <ApprovalCard
        action={{
          type: 'clarification',
          requestId: 'clarify-1',
          questions: [{ id: 'model', prompt: 'Which model?', required: true }],
        }}
        busy={false}
        onAddress={jest.fn()}
        onClarification={onClarification}
        onDomains={jest.fn()}
        onSeatHold={jest.fn()}
      />,
    );

    fireEvent.changeText(view.UNSAFE_getByType(TextInput), 'A55');
    fireEvent.press(screen.getByRole('button', { name: 'submitAnswers' }));
    expect(onClarification).toHaveBeenCalledWith({ model: 'A55' });
  });

  it('approves only the merchant domains selected by the user', () => {
    const onDomains = jest.fn();
    render(
      <ApprovalCard
        action={{
          type: 'domain_approval',
          requestId: 'domains-1',
          candidates: [
            {
              id: 'amazon',
              name: 'Amazon Egypt',
              domain: 'amazon.eg',
              category: 'retail',
              market: 'EG',
              currency: 'EGP',
            },
            {
              id: 'noon',
              name: 'Noon Egypt',
              domain: 'noon.com',
              category: 'retail',
              market: 'EG',
              currency: 'EGP',
            },
          ],
        }}
        busy={false}
        onAddress={jest.fn()}
        onClarification={jest.fn()}
        onDomains={onDomains}
        onSeatHold={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByText('Amazon Egypt · amazon.eg'));
    fireEvent.press(screen.getByText('approveSelected'));
    expect(onDomains).toHaveBeenCalledWith(['amazon.eg']);
  });

  it('renders incomplete/excluded context and a failed merchant event honestly', () => {
    const candidate = render(
      <CandidateCard
        isWinner={false}
        offer={{
          ...baseOffer,
          price: { ...baseOffer.price, finalTotal: null },
          incompleteFields: ['deliveryFee'],
        }}
        validity="incomplete"
      />,
    );
    expect(screen.getByText('deliveryFee')).toBeTruthy();
    candidate.unmount();

    render(
      <RunTimeline
        events={[
          {
            id: 'event-failed',
            runId: run.id,
            type: 'merchant.attempt_completed',
            status: 'comparing',
            timestamp: run.updatedAt,
            payload: {
              attemptId: 'attempt-1',
              outcome: 'blocked',
              failureCode: 'MERCHANT_BLOCKED',
              evidenceIds: [],
            },
          },
          {
            id: 'run-failed',
            runId: run.id,
            type: 'run.failed',
            status: 'failed',
            timestamp: run.updatedAt,
            payload: {
              failedAt: run.updatedAt,
              failureCode: 'BROWSER_TTL_EXPIRED',
              retryable: false,
            },
          },
        ]}
      />,
    );
    expect(screen.getByText(/MERCHANT_BLOCKED/)).toBeTruthy();
    expect(screen.getByText('BROWSER_TTL_EXPIRED')).toBeTruthy();
  });

  it('opens evidence screenshots full-screen and closes the preview', () => {
    render(
      <EvidenceGallery
        evidence={[
          {
            id: 'evidence-screenshot-1',
            kind: 'screenshot',
            uri: 'https://demo.example/evidence.png',
            sha256: 'a'.repeat(64),
            capturedAt: run.updatedAt,
            merchantAttemptId: 'attempt-1',
            redacted: true,
          },
        ]}
      />,
    );

    fireEvent.press(
      screen.getByRole('button', {
        name: 'openScreenshot evidence-screenshot-1',
      }),
    );
    expect(screen.getByTestId('evidence-lightbox')).toBeTruthy();
    expect(screen.getByTestId('evidence-screenshot-full')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'close' }));
    expect(screen.queryByTestId('evidence-screenshot-full')).toBeNull();
  });

  it('renders warnings, excluded offers, and partial failures from a partial report', () => {
    const partialReport: RunReport = {
      id: 'report-1',
      runId: run.id,
      status: 'in_progress',
      category: 'retail',
      market: 'EG',
      currency: 'EGP',
      timezone: 'Africa/Cairo',
      generatedAt: run.updatedAt,
      merchantAttempts: [
        {
          id: 'attempt-1',
          merchantId: 'noon-eg',
          merchantName: 'Noon Egypt',
          merchantDomain: 'noon.com',
          category: 'retail',
          outcome: 'timed_out',
          startedAt: run.createdAt,
          finishedAt: run.updatedAt,
          failureCode: 'MERCHANT_TIMEOUT',
          message: 'Merchant timed out.',
          evidenceIds: [],
        },
      ],
      validOffers: [],
      incompleteOffers: [],
      excludedOffers: [
        {
          ...baseOffer,
          id: 'excluded-1',
          exclusionReason: 'WRONG_VARIANT',
        },
      ],
      couponAttempts: [],
      evidence: [],
      warnings: [
        {
          code: 'PARTIAL_RESULT',
          message: 'One merchant failed.',
          evidenceIds: [],
        },
      ],
      partialFailures: [
        {
          merchantAttemptId: 'attempt-1',
          code: 'PARTIAL_TIMEOUT',
          message: 'Noon did not finish.',
          retryable: true,
        },
      ],
      conclusion: null,
    };
    query.mockReturnValue({ data: partialReport, isError: false });

    render(<ShoppingReportScreen />);

    expect(screen.getByText(/WRONG_VARIANT/)).toBeTruthy();
    expect(screen.getByText(/PARTIAL_RESULT/)).toBeTruthy();
    expect(screen.getByText(/PARTIAL_TIMEOUT/)).toBeTruthy();
  });

  it('claims control for the same viewer, sends the token as a header, and disables expired control', async () => {
    const lease = {
      id: 'lease-1',
      runId: run.id,
      holderUserId: 'user-1',
      status: 'active' as const,
      claimedAt: run.updatedAt,
      renewedAt: run.updatedAt,
      expiresAt: run.browserExpiresAt,
    };
    viewerToken.mockImplementation(async (_runId, mode) => ({
      token: mode === 'view' ? 'view-secret' : 'control-secret',
      tokenType: 'Bearer',
      mode,
      viewerUrl: 'https://demo.example/viewer/',
      expiresAt: run.browserExpiresAt,
    }));
    claim.mockResolvedValue({
      run: { ...run, status: 'user_takeover' },
      lease,
    });
    release.mockResolvedValue({
      run,
      lease: { ...lease, status: 'released' },
    });
    let view: ReturnType<typeof render>;
    const onRunChanged = jest.fn((nextRun: RunResource) => {
      view.rerender(
        <RemoteBrowser
          onRunChanged={onRunChanged}
          runId={run.id}
          status={nextRun.status}
        />,
      );
    });
    view = render(
      <RemoteBrowser
        onRunChanged={onRunChanged}
        runId={run.id}
        status="ready_for_handoff"
      />,
    );

    await waitFor(() =>
      expect(viewerToken).toHaveBeenCalledWith(run.id, 'view'),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'takeOver' }).props
          .accessibilityState.disabled,
      ).toBe(false),
    );
    fireEvent.press(screen.getByRole('button', { name: 'takeOver' }));
    await waitFor(() =>
      expect(viewerToken).toHaveBeenCalledWith(run.id, 'control', 'lease-1'),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('webview').props.source.headers.Authorization,
      ).toBe('Bearer control-secret'),
    );
    const source = screen.getByTestId('webview').props.source;
    expect(source.uri).not.toContain('control-secret');
    expect(source.headers.Authorization).toBe('Bearer control-secret');
    expect(screen.getByTestId('webview').props.setSupportMultipleWindows).toBe(
      false,
    );

    view.rerender(
      <RemoteBrowser
        expiredLeaseId="lease-1"
        onRunChanged={onRunChanged}
        runId={run.id}
        status="user_takeover"
      />,
    );
    await waitFor(() => expect(screen.getByText('viewOnly')).toBeTruthy());
  });

  it('allows manual browser takeover while automation is paused', async () => {
    viewerToken.mockResolvedValue({
      token: 'view-secret',
      tokenType: 'Bearer',
      mode: 'view',
      viewerUrl: 'https://demo.example/viewer/',
      expiresAt: run.browserExpiresAt,
    });
    render(
      <RemoteBrowser onRunChanged={jest.fn()} runId={run.id} status="paused" />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'takeOver' }).props
          .accessibilityState.disabled,
      ).toBe(false),
    );
  });
});

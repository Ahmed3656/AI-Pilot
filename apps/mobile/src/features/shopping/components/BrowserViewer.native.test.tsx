import { render } from '@testing-library/react-native';
import { BrowserViewer } from './BrowserViewer.native';

const mockWebView = jest.fn((_props: Record<string, unknown>) => null);

jest.mock('react-native-webview', () => ({
  WebView: (props: Record<string, unknown>) => mockWebView(props),
}));

describe('native remote browser viewer', () => {
  beforeEach(() => mockWebView.mockClear());

  it('keeps authentication cookies and allows only viewer-origin navigation', () => {
    render(
      <BrowserViewer
        borderColor="#d0d5dd"
        interactive={false}
        token="Bearer viewer-secret"
        uri="http://192.168.1.9:8080/viewer/?autoconnect=1"
        viewerOrigin="http://192.168.1.9:8080"
      />,
    );

    const props = mockWebView.mock.calls[0]?.[0] as unknown as {
      onShouldStartLoadWithRequest: (request: { url: string }) => boolean;
      originWhitelist: string[];
      sharedCookiesEnabled: boolean;
      source: { headers: { Authorization: string }; uri: string };
      thirdPartyCookiesEnabled: boolean;
    };

    expect(props.originWhitelist).toEqual(['http://192.168.1.9:8080']);
    expect(props.sharedCookiesEnabled).toBe(true);
    expect(props.thirdPartyCookiesEnabled).toBe(true);
    expect(props.source.headers.Authorization).toBe('Bearer viewer-secret');
    expect(props.onShouldStartLoadWithRequest({ url: 'about:blank' })).toBe(
      true,
    );
    expect(
      props.onShouldStartLoadWithRequest({
        url: 'http://192.168.1.9:8080/viewer/vnc.html',
      }),
    ).toBe(true);
    expect(
      props.onShouldStartLoadWithRequest({
        url: 'https://attacker.example/viewer/vnc.html',
      }),
    ).toBe(false);
  });
});

import { CSSProperties } from 'react';

interface BrowserViewerProps {
  borderColor: string;
  interactive: boolean;
  token: string;
  uri: string;
  viewerOrigin: string;
}

export function BrowserViewer({
  borderColor,
  interactive,
  token,
  uri,
}: BrowserViewerProps) {
  const style: CSSProperties = {
    backgroundColor: '#101828',
    border: `1px solid ${borderColor}`,
    borderRadius: 12,
    boxSizing: 'border-box',
    height: 380,
    pointerEvents: interactive ? 'auto' : 'none',
    width: '100%',
  };

  return (
    <iframe
      allow="clipboard-read; clipboard-write"
      key={token}
      loading="eager"
      src={uri}
      style={style}
      title="DealPilot remote browser"
    />
  );
}

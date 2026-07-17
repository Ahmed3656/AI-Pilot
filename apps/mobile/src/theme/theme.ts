export interface AppTheme {
  colors: {
    background: string;
    surface: string;
    text: string;
    muted: string;
    primary: string;
    primaryText: string;
    border: string;
    success: string;
    warning: string;
    warningSurface: string;
    danger: string;
  };
  spacing: { xs: number; sm: number; md: number; lg: number; xl: number };
  radius: { sm: number; md: number; lg: number };
}

export const lightTheme: AppTheme = {
  colors: {
    background: '#F7F8FC',
    surface: '#FFFFFF',
    text: '#172033',
    muted: '#667085',
    primary: '#4F46E5',
    primaryText: '#FFFFFF',
    border: '#E4E7EC',
    success: '#067647',
    warning: '#B54708',
    warningSurface: '#FFFAEB',
    danger: '#B42318',
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 8, md: 14, lg: 20 },
};

export const darkTheme: AppTheme = {
  ...lightTheme,
  colors: {
    ...lightTheme.colors,
    background: '#172033',
    surface: '#101828',
    text: '#F7F8FC',
    muted: '#98A2B3',
    primary: '#A5B4FC',
    primaryText: '#172033',
    border: '#344054',
    success: '#6CE9A6',
    warning: '#FEC84B',
    warningSurface: '#332B18',
    danger: '#FDA29B',
  },
};

export type ThemeMode = 'light' | 'dark' | 'system';

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
    danger: '#B42318',
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 8, md: 14, lg: 20 },
};

export const darkTheme: AppTheme = {
  ...lightTheme,
  colors: {
    ...lightTheme.colors,
    background: '#0F172A',
    surface: '#172033',
    text: '#F8FAFC',
    muted: '#98A2B3',
    border: '#344054',
  },
};

export type ThemeMode = 'light' | 'dark' | 'system';

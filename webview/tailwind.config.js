/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // VS Code theme-aware colors using CSS variables
        'vscode-bg': 'var(--vscode-editor-background)',
        'vscode-fg': 'var(--vscode-editor-foreground)',
        'vscode-border': 'var(--vscode-panel-border)',
        'vscode-tab-active': 'var(--vscode-tab-activeBackground)',
        'vscode-tab-inactive': 'var(--vscode-tab-inactiveBackground)',
        'vscode-input-bg': 'var(--vscode-input-background)',
        'vscode-selection': 'var(--vscode-editor-selectionBackground)',
        'vscode-hover': 'var(--vscode-list-hoverBackground)',
        'vscode-accent': 'var(--vscode-focusBorder)',
      },
      fontSize: {
        'vscode': 'var(--vscode-font-size, 13px)',
      },
      fontFamily: {
        'vscode': 'var(--vscode-font-family, sans-serif)',
        'vscode-mono': 'var(--vscode-editor-font-family, monospace)',
      },
    },
  },
  plugins: [],
};

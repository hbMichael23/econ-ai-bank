import { defineConfig, presetUno } from 'unocss';

export default defineConfig({
  presets: [presetUno()],
  theme: {
    colors: {
      ink: 'var(--c-ink)',
      paper: 'var(--c-paper)',
      panel: 'var(--c-panel)',
      line: 'var(--c-line)',
      pine: {
        50: '#edf4ef',
        100: '#d7e5db',
        200: '#b3cdbd',
        300: '#87ae98',
        400: '#5f8e77',
        500: '#42725d',
        600: '#305c4b',
        700: '#274b3e',
        800: '#1d3a31',
        900: '#152e27',
        950: '#0d211c'
      },
      gold: {
        50: '#faf5e9',
        100: '#f2e6c9',
        200: '#e8d29e',
        300: '#dab76e',
        400: '#c89d4e',
        500: '#ad7f3b',
        600: '#8a622f',
        700: '#684a27'
      },
      clay: {
        50: '#fbf0ec',
        100: '#f4dcd3',
        200: '#e9bfb1',
        400: '#c57d66',
        500: '#ab5f49',
        600: '#8d4938'
      }
    },
    fontFamily: {
      sans: 'Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
      serif: '"Noto Serif SC", "Songti SC", "STSong", "SimSun", serif'
    }
  },
  shortcuts: {
    'paper-card': 'bg-panel border border-line rounded-2xl shadow-sm',
    'section-title': 'font-serif text-xl text-ink font-600 tracking-tight',
    'muted': 'text-ink/50 text-xs leading-5',
    'field-label': 'block text-xs font-600 text-ink/60 mb-1.5',
    'toolbar-btn': 'inline-flex items-center justify-center gap-1 rounded-lg px-2.5 py-1.5 text-xs transition cursor-pointer select-none'
  }
});

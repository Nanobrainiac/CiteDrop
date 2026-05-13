/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0b0c0b',
        panel: '#151714',
        panelSoft: '#222420',
        acid: '#e6ff3f',
        moss: '#657400',
        ember: '#c92605'
      },
      boxShadow: {
        glow: '0 0 40px rgba(230, 255, 63, 0.18)'
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
};

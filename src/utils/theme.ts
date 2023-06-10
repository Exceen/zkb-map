export const theme = {
  background: '#060606',
  colorMaxSec: '#66A0BC',
  colorMinSec: '#a1a1a1',
//  flare: '#E60000',
//  flare: '#7d0000',
  flare: '#770000',
  text: '#E6E6E6',
  unit: 32,
  gapSize: 8,
  regionFontSize: 8
}

export type Theme = typeof theme

declare module 'styled-components' {
  export interface DefaultTheme extends Theme {}
}

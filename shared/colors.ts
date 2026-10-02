/** One color identity for the profile, renderer, swatches and model input. */
export const BOT_COLORS = ['red', 'green', 'purple', 'blue'] as const;
export type BotColor = (typeof BOT_COLORS)[number];

export const BOT_APPEARANCE = {
  red: { hex: '#ff6b5b', description: 'red (coral)' },
  green: { hex: '#c4f04a', description: 'green (lime)' },
  purple: { hex: '#b49cff', description: 'purple (lavender)' },
  blue: { hex: '#45dde6', description: 'blue (cyan, turquoise)' },
} as const satisfies Record<BotColor, { hex: string; description: string }>;

export const PALETTE = BOT_COLORS.map((color) => BOT_APPEARANCE[color].hex);

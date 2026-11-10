import { echarts, type ChartOption } from '@/lib/chart/echarts';

/** Resolved (computed) colour values for the active theme. Read at runtime from the CSS tokens. */
export interface ChartTokens {
  /** 8 series colours, accent first. */
  series: string[];
  text: string;
  textBody: string;
  textSecondary: string;
  textTertiary: string;
  hairline: string;
  hairlineStrong: string;
  surface: string;
  raised: string;
  accent: string;
  fontFamily: string;
  fontMono: string;
  /** Animation switches: one 400ms entrance, none under reduced motion. */
  animate: boolean;
}

/** Resolve any CSS colour (including var(--x), rgb(r g b / a)) to a canvas-safe `rgb()/rgba()` string. */
function resolveColor(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved;
}

/** Read the chart tokens from the document. Call in the browser only. */
export function readChartTokens(): ChartTokens {
  const v = (name: string) => resolveColor(`var(${name})`);
  const series = Array.from({ length: 8 }, (_, i) => v(`--chart-${i + 1}`));
  return {
    series,
    text: v('--text-primary'),
    textBody: v('--text-body'),
    textSecondary: v('--text-secondary'),
    textTertiary: v('--text-tertiary'),
    hairline: v('--border-hairline'),
    hairlineStrong: v('--border-strong'),
    surface: v('--surface'),
    raised: v('--raised'),
    accent: v('--accent'),
    fontFamily: getComputedStyle(document.body).fontFamily,
    fontMono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}

/** Apply alpha to a resolved colour string. */
export function withAlpha(color: string, alpha: number): string {
  return echarts.color.modifyAlpha(color, alpha);
}

/** Series colour by index, wrapping around the 8-colour palette. */
export function seriesColor(t: ChartTokens, i: number): string {
  return t.series[i % t.series.length] ?? t.accent;
}

/**
 * Base ECharts option carrying the Linear-style theme: transparent canvas,
 * tertiary 11px axis labels, hairline grid, brand series palette, a single
 * 400ms entrance. Option builders spread this and add their series.
 */
export function chartTheme(t: ChartTokens): ChartOption {
  return {
    color: t.series,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: t.fontFamily, fontSize: 11, color: t.textTertiary },
    animation: t.animate,
    animationDuration: 400,
    animationEasing: 'cubicOut',
    animationDurationUpdate: 150,
    animationEasingUpdate: 'cubicOut',
    grid: { left: 4, right: 8, top: 12, bottom: 4, containLabel: true },
    tooltip: tooltipOption(t),
    legend: {
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 14,
      textStyle: { color: t.textSecondary, fontSize: 12 },
      inactiveColor: t.textTertiary,
    },
  };
}

/** Linear-style tooltip: raised surface, hairline border, 8px radius, small shadow. */
export function tooltipOption(t: ChartTokens): Record<string, unknown> {
  return {
    backgroundColor: t.raised,
    borderColor: t.hairlineStrong,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: t.text, fontSize: 12, fontFamily: t.fontFamily },
    extraCssText: 'border-radius:8px;box-shadow:var(--elev-pop);',
    confine: true,
    transitionDuration: 0.1,
    axisPointer: {
      type: 'line',
      lineStyle: { color: t.hairlineStrong, width: 1 },
      z: 0,
    },
  };
}

/** Escape text going into tooltip HTML. */
export function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Tooltip row: coloured dot + label + right-aligned value. */
export function tooltipRow(t: ChartTokens, color: string, label: string, value: string): string {
  return (
    `<div style="display:flex;align-items:center;gap:8px;line-height:18px">` +
    `<span style="width:6px;height:6px;border-radius:9999px;background:${color};flex:none"></span>` +
    `<span style="color:${t.textSecondary}">${esc(label)}</span>` +
    `<span style="margin-left:auto;padding-left:16px;color:${t.text};font-variant-numeric:tabular-nums">${esc(value)}</span>` +
    `</div>`
  );
}

/** 12400 -> "12.4K". */
export function compact(n: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

import Svg, { Ellipse, Path, Polygon } from 'react-native-svg';

/**
 * Belöningsknappens ikon i kretsfliken: en stjärna i en lagerkrans.
 *
 * Svg och inte kanter, för en krans är blad längs en båge — det går inte att
 * bygga av `border*` som nivåmärkenas stjärnor. Ritad i en 24-ruta som
 * ikonfonterna, så att den står i samma storlek som chatt- och veckoikonen
 * bredvid. Inget rör sig.
 *
 * Kransen är två grenar som möts nertill med ett glapp. Bladen räknas fram
 * längs en cirkel i stället för att skrivas ut, och högergrenen är vänster
 * speglad — så att de två aldrig kan bli olika.
 */

const CX = 12;
const CY = 11.4;
const R = 8.6;
// Vinklar medurs från tolvslaget. Vänstergrenen går från strax vänster om
// sextiden upp till tiotiden; glappet nertill är där grenarna möts.
const STEM_FROM = 202;
const STEM_TO = 322;
const LEAVES = [210, 232, 254, 276, 298, 318];
// Bladens lutning utåt från bågen: ett blad som följer bågen exakt läser som
// ett pärlband, inte som en krans.
const LEAF_TILT = -30;

const rad = (deg: number) => (deg * Math.PI) / 180;
const onCircle = (deg: number, r = R) => ({
  x: CX + r * Math.sin(rad(deg)),
  y: CY - r * Math.cos(rad(deg)),
});

function starPoints(cx: number, cy: number, outer: number, inner: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rad(-90 + i * 36);
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

const STAR = starPoints(CX, CY - 0.6, 4.6, 1.95);

type Props = {
  size?: number;
  color: string;
  /** Fylld stjärna när kretsen har en belöning, kontur när den inte har det. */
  filled?: boolean;
};

export function RewardWreathIcon({ size = 26, color, filled = false }: Props) {
  const from = onCircle(STEM_FROM);
  const to = onCircle(STEM_TO);
  const leaves = LEAVES.map(deg => {
    const p = onCircle(deg, R + 0.5);
    return { ...p, rot: deg + 90 + LEAF_TILT };
  });
  const mirror = (x: number) => 24 - x;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {/* Stjälkarna, en per sida. */}
      <Path
        d={`M${from.x} ${from.y} A${R} ${R} 0 0 1 ${to.x} ${to.y}`}
        stroke={color} strokeWidth={1.1} strokeLinecap="round" fill="none"
      />
      <Path
        d={`M${mirror(from.x)} ${from.y} A${R} ${R} 0 0 0 ${mirror(to.x)} ${to.y}`}
        stroke={color} strokeWidth={1.1} strokeLinecap="round" fill="none"
      />
      {leaves.map((l, i) => (
        <Ellipse
          key={`l${i}`} cx={l.x} cy={l.y} rx={1.05} ry={2.25} fill={color}
          rotation={l.rot} origin={`${l.x}, ${l.y}`}
        />
      ))}
      {leaves.map((l, i) => (
        <Ellipse
          key={`r${i}`} cx={mirror(l.x)} cy={l.y} rx={1.05} ry={2.25} fill={color}
          rotation={-l.rot} origin={`${mirror(l.x)}, ${l.y}`}
        />
      ))}
      <Polygon
        points={STAR}
        fill={filled ? color : 'none'}
        stroke={color} strokeWidth={1.3} strokeLinejoin="round"
      />
    </Svg>
  );
}

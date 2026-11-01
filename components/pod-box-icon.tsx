import { useId } from 'react';
import Svg, { Defs, Ellipse, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/**
 * Lådan i miniatyr — markeringen i hörnet av en lådpaus kort i statistiken
 * (app/stats.tsx). Ritad efter renderingen av lådan: ljus ek, locket som ett
 * band med toppen synlig ovanför, och displayen med pausens två streck.
 *
 * **Kulörerna är fasta**, som post-it-lappens `PAPER`: lådan är samma ek mot
 * vilken botten som helst. Den ritas i svg och inte som en bild, för den
 * renderade bilden har en egen mörk botten och hade blivit en ruta på kortet.
 *
 * Ett helt kort i ek, och sedan en ton av ek, prövades först och var för
 * starka bredvid resten av listan — liksom displayen i full storlek. Lådan i
 * hörnet är hela markeringen; kortet är ett vanligt kort.
 */

const OAK_TOP = '#ddb077';
const OAK_LID = '#c99458';
const OAK_FRONT_HI = '#d5a265';
const OAK_FRONT_LO = '#bd884e';
const GRAIN = '#8a5a2b';
const DISPLAY = '#0d1218';
const GLOW = '#9fcbff';

export function PodBoxIcon({ width = 52 }: { width?: number }) {
  const gradId = `pod${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg width={width} height={width * (38 / 64)} viewBox="0 0 64 38" accessibilityElementsHidden importantForAccessibility="no">
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="13" x2="0" y2="34" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={OAK_FRONT_HI} />
          <Stop offset="1" stopColor={OAK_FRONT_LO} />
        </LinearGradient>
      </Defs>

      <Ellipse cx={32} cy={35.5} rx={27} ry={2.2} fill="#000000" opacity={0.16} />

      {/* Lådan. Alla linjer är raka och vågräta, och rundningarna små —
          en pillerformad lockkant och sneda ådringslinjer fick locket att se
          böjt ut. */}
      <Rect x={6} y={13} width={52} height={21} rx={2.5} fill={`url(#${gradId})`} />
      <Line x1={9} y1={19} x2={55} y2={19} stroke={GRAIN} strokeWidth={0.6} opacity={0.2} />
      <Line x1={9} y1={29.5} x2={55} y2={29.5} stroke={GRAIN} strokeWidth={0.6} opacity={0.16} />

      {/* Locket, som på renderingen: en stor topp (en symmetrisk, rak
          trapets) och en tunn kant som bara sticker ut en hårsmån över
          lådan. En tjock kant läste som ett eget block ovanpå. */}
      <Path
        d="M9 4 L55 4 L58 10 L6 10 Z"
        fill={OAK_TOP} stroke={OAK_TOP} strokeWidth={1} strokeLinejoin="round"
      />
      <Line x1={12} y1={7} x2={52} y2={7} stroke={GRAIN} strokeWidth={0.5} opacity={0.18} />
      <Rect x={5.5} y={10} width={53} height={3} rx={1} fill={OAK_LID} />
      <Line x1={6.5} y1={13} x2={57.5} y2={13} stroke={GRAIN} strokeWidth={0.6} opacity={0.35} />

      {/* Displayen, mitt på lådans framsida */}
      <Rect x={22} y={19.75} width={20} height={7.5} rx={2} fill={DISPLAY} />
      <Rect x={25} y={21.65} width={1.1} height={3.7} rx={0.5} fill={GLOW} />
      <Rect x={27.2} y={21.65} width={1.1} height={3.7} rx={0.5} fill={GLOW} />
      <Rect x={31.5} y={22.75} width={7.5} height={1.5} rx={0.75} fill={GLOW} opacity={0.8} />
    </Svg>
  );
}

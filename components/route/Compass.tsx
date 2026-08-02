// Kompasroos (scherm 03). Windpijl wijst NAAR de richting waar de wind vandaan komt.
// diameter 110px, achtergrond --s3, ticks --bd2/--bd, noord-tick --t1, pijl --water.
export default function Compass({ deg }: { deg: number }) {
  const cx = 55, cy = 55, R1 = 38, R2 = 18;
  const r = ((((deg % 360) + 360) % 360) * Math.PI) / 180;
  const tipX = cx + R1 * Math.sin(r), tipY = cy - R1 * Math.cos(r);
  const tailX = cx - R2 * Math.sin(r), tailY = cy + R2 * Math.cos(r);
  return (
    <svg width="110" height="110" viewBox="0 0 110 110" style={{ flex: "none" }}>
      <circle cx="55" cy="55" r="50" fill="var(--s3)" stroke="var(--bd2)" strokeWidth="1" />
      <line x1="55" y1="7" x2="55" y2="17" stroke="var(--t1)" strokeWidth="2" strokeLinecap="round" />
      <line x1="103" y1="55" x2="93" y2="55" stroke="var(--bd2)" strokeWidth="1.2" />
      <line x1="55" y1="103" x2="55" y2="93" stroke="var(--bd2)" strokeWidth="1.2" />
      <line x1="7" y1="55" x2="17" y2="55" stroke="var(--bd2)" strokeWidth="1.2" />
      <line x1="90.4" y1="19.6" x2="83.5" y2="26.5" stroke="var(--bd)" strokeWidth="1" />
      <line x1="90.4" y1="90.4" x2="83.5" y2="83.5" stroke="var(--bd)" strokeWidth="1" />
      <line x1="19.6" y1="90.4" x2="26.5" y2="83.5" stroke="var(--bd)" strokeWidth="1" />
      <line x1="19.6" y1="19.6" x2="26.5" y2="26.5" stroke="var(--bd)" strokeWidth="1" />
      <text x="55" y="5" textAnchor="middle" fontFamily="var(--mono)" fontSize="10" fontWeight="700" fill="var(--t1)">N</text>
      <text x="107" y="58" textAnchor="middle" fontFamily="var(--mono)" fontSize="9" fill="var(--t3)">O</text>
      <text x="55" y="109" textAnchor="middle" fontFamily="var(--mono)" fontSize="9" fill="var(--t3)">Z</text>
      <text x="3" y="58" textAnchor="middle" fontFamily="var(--mono)" fontSize="9" fill="var(--t3)">W</text>
      <line x1={tailX} y1={tailY} x2={tipX} y2={tipY} stroke="var(--water)" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={tipX} cy={tipY} r="4.5" fill="var(--water)" />
      <circle cx="55" cy="55" r="5" fill="var(--s2)" stroke="var(--water)" strokeWidth="1.8" />
    </svg>
  );
}

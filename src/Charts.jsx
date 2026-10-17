// The two charts the results show, drawn as plain SVG: a value over time, and the range of futures by year. No
// chart library: the app loads nothing it does not carry.
const W = 900, H = 260, PAD = { l: 78, r: 12, t: 10, b: 24 };

function scale(lo, hi, a, b) {
  const span = hi - lo || 1;
  return (v) => a + ((v - lo) / span) * (b - a);
}

function Axis({ lo, hi, y, format }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => lo + k * (hi - lo));
  return ticks.map((v, i) => (
    <g key={i}>
      <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="grid" />
      <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" className="tick">{format(v)}</text>
    </g>
  ));
}

export function Line({ days, values, format }) {
  if (!values?.length) return null;
  const lo = Math.min(...values), hi = Math.max(...values);
  const x = scale(0, values.length - 1, PAD.l, W - PAD.r), y = scale(lo, hi, H - PAD.b, PAD.t);
  const step = Math.max(1, Math.floor(values.length / 900));
  let d = "";
  for (let i = 0; i < values.length; i += step) d += `${i ? "L" : "M"}${x(i).toFixed(1)},${y(values[i]).toFixed(1)}`;
  d += `L${x(values.length - 1).toFixed(1)},${y(values.at(-1)).toFixed(1)}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" data-testid="curve" role="img">
      <Axis lo={lo} hi={hi} y={y} format={format} />
      <path d={d} className="line" />
      <text x={PAD.l} y={H - 6} className="tick">{days[0]}</text>
      <text x={W - PAD.r} y={H - 6} textAnchor="end" className="tick">{days.at(-1)}</text>
    </svg>
  );
}

// fan: [{year, q: [5th, 25th, 50th, 75th, 95th], ruined, withdrawal}]
export function Fan({ fan, format }) {
  if (!fan?.length) return null;
  const hi = Math.max(...fan.map((a) => a.q[3])) * 1.05;        // to the 75th: the 95th would flatten the rest
  const x = scale(0, fan.length - 1, PAD.l, W - PAD.r), y = scale(0, hi, H - PAD.b, PAD.t);
  const path = (k) => fan.map((a, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(Math.min(a.q[k], hi)).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" data-testid="fan" role="img">
      <Axis lo={0} hi={hi} y={y} format={format} />
      {[0, 1, 3, 4].map((k) => <path key={k} d={path(k)} className="band" />)}
      <path d={path(2)} className="line" />
      <text x={PAD.l} y={H - 6} className="tick">0</text>
      <text x={W - PAD.r} y={H - 6} textAnchor="end" className="tick">{fan.at(-1).year}</text>
    </svg>
  );
}

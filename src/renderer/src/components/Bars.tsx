import { HUES, hueStyle, type Hue } from '../lib/hues';

/**
 * A bar chart, drawn by hand.
 *
 * No charting library: the app must work on a shop PC with no internet, every
 * kilobyte is a slower start on a counter machine, and a bar chart is a dozen
 * rectangles. Drawn in the screen's own hue so a chart belongs to the screen
 * it is on, and labelled with figures, because a shopkeeper reads the number
 * and uses the bar only to compare it with its neighbours.
 */
export interface Bar {
  label: string;
  value: number;
  /** Shown under the label — a count of bills, a second figure. */
  note?: string;
  /** The one bar that is today, or the biggest: drawn solid. */
  accent?: boolean;
}

export function Bars({
  bars,
  format,
  hue = 'indigo',
  horizontal = false,
  multi = false,
  empty = 'Nothing to show for this range.',
}: {
  bars: Bar[];
  format: (value: number) => string;
  hue?: Hue;
  /** Labels down the side instead of along the bottom: for names, not dates. */
  horizontal?: boolean;
  /**
   * A colour each, cycling the app's six hues. For bars that are different
   * things — products, categories, ways of paying — where one colour makes
   * six rows look like one measurement. A series of days is not one of those:
   * the same thing on different days keeps the same colour.
   */
  multi?: boolean;
  empty?: string;
}) {
  const hueOf = (index: number): Hue => (multi ? (HUES[index % HUES.length] ?? hue) : hue);
  const top = Math.max(...bars.map((b) => b.value), 0);

  if (bars.length === 0 || top <= 0) {
    return <p className="chart-empty">{empty}</p>;
  }

  if (horizontal) {
    return (
      <div className="bars rows" style={hueStyle(hue)}>
        {bars.map((bar, i) => (
          <div className="bar-row" key={bar.label} style={hueStyle(hueOf(i))}>
            <span className="bar-label" title={bar.label}>
              {bar.label}
            </span>
            <span className="bar-track">
              <span
                className={bar.accent ? 'bar-fill on' : 'bar-fill'}
                style={{ width: `${Math.max(2, (bar.value / top) * 100)}%` }}
              />
            </span>
            <span className="bar-value">{format(bar.value)}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="bars columns" style={hueStyle(hue)}>
      {bars.map((bar, i) => (
        <div className="bar-col" key={bar.label} style={hueStyle(hueOf(i))}>
          {/* A day that took nothing says so with an empty column, not with a
              row of zeroes along the top. */}
          <span className="bar-value">{bar.value > 0 ? format(bar.value) : ''}</span>
          <span className="bar-track">
            <span
              className={bar.accent ? 'bar-fill on' : 'bar-fill'}
              /* A day with nothing taken still gets a sliver, so the column
                 reads as empty rather than missing. */
              style={{ height: `${Math.max(2, (bar.value / top) * 100)}%` }}
            />
          </span>
          <span className="bar-label">{bar.label}</span>
          {bar.note && <span className="bar-note">{bar.note}</span>}
        </div>
      ))}
    </div>
  );
}

const { useState, useEffect, useMemo, useCallback } = React;
const {
  ComposedChart, LineChart, BarChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceLine, ResponsiveContainer,
} = Recharts;

const LOCATION_NAMES = ["Edgewood", "Meridian", "Dundee", "Loveland"];
const LOCATION_FILES = {
  Edgewood: "data/edgewood.json",
  Meridian: "data/meridian.json",
  Dundee: "data/dundee.json",
  Loveland: "data/loveland.json",
};
const HOURLY_FILES = {
  Edgewood: "data/edgewood_hourly.json",
  Meridian: "data/meridian_hourly.json",
  Dundee: "data/dundee_hourly.json",
  Loveland: "data/loveland_hourly.json",
};
const DAY_CATEGORIES = ["Breads", "Pastries", "Desserts"];
const TAB_CATEGORIES = ["Breads", "Pastries", "Desserts", "Breakfast & Lunch", "After 2PM", "Hourly Demand", "Forecasting"];
// These categories don't have day-of-week data — just a flat weekly total per
// item — so they share the same "ranked popularity" view instead of the
// day-of-week charts.
const SIMPLE_CATEGORIES = ["Breakfast & Lunch", "After 2PM"];

const CREDENTIALS = [
  { username: "jonahwilson", passcode: "5595215263", displayName: "Jonah" },
  { username: "sethquiring", passcode: "4025604770", displayName: "Seth" },
];

const DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const DEFAULT_ACTIVE = {
  Breads: ["White Sourdough"],
  Pastries: ["Cinnamon Roll Individual"],
  Desserts: ["Lemon Bar"],
};

const LINE_COLORS = ["#C41230"];

function colorForIndex(i) { return LINE_COLORS[i % LINE_COLORS.length]; }
function itemTotalVolume(entry) { return entry.total_weekly.reduce((a, b) => a + b, 0); }

function formatDateLabel(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

function addDaysISO(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function rollingAvg(arr) {
  return arr.map((_, i) => {
    const start = Math.max(0, i - 2);
    const slice = arr.slice(start, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

function linregForecast(y, nFuture) {
  const n = y.length;
  if (n === 0) return { forecasts: Array(nFuture).fill(0), residStd: 0, slope: 0 };
  if (n === 1) return { forecasts: Array(nFuture).fill(y[0]), residStd: 0, slope: 0 };
  const xs = y.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (y[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const slope = den !== 0 ? num / den : 0;
  const intercept = meanY - slope * meanX;
  const predsIn = xs.map((x) => slope * x + intercept);
  const residuals = y.map((v, i) => v - predsIn[i]);
  const residStd = n > 2 ? Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / (n - 2)) : 0;
  const forecasts = [];
  for (let k = n; k < n + nFuture; k++) forecasts.push(slope * k + intercept);
  return { forecasts, residStd, slope };
}

function computeAllDerived(weeksSorted) {
  const n = weeksSorted.length;
  const labels = weeksSorted.map((w) => formatDateLabel(w.date));
  const lastDate = n > 0 ? weeksSorted[n - 1].date : null;
  const forecastLabels = [];
  for (let k = 1; k <= 4; k++) {
    const d = lastDate ? addDaysISO(lastDate, 7 * k) : null;
    forecastLabels.push(d ? formatDateLabel(d) : `+${k}wk`);
  }

  const buckets = {};
  DAY_CATEGORIES.forEach((cat) => (buckets[cat] = {}));

  const itemsByCat = {};
  weeksSorted.forEach((w) => {
    DAY_CATEGORIES.forEach((cat) => {
      const catData = w.data[cat] || {};
      itemsByCat[cat] = itemsByCat[cat] || new Set();
      Object.keys(catData).forEach((item) => itemsByCat[cat].add(item));
    });
  });

  DAY_CATEGORIES.forEach((cat) => {
    const items = itemsByCat[cat] || new Set();
    items.forEach((item) => {
      const daysUsed = new Set();
      weeksSorted.forEach((w) => {
        const d = (w.data[cat] && w.data[cat][item]) || {};
        Object.keys(d).forEach((day) => daysUsed.add(day));
      });
      const day_weekly = {};
      DAY_ORDER.forEach((day) => {
        if (!daysUsed.has(day)) return;
        day_weekly[day] = weeksSorted.map(
          (w) => (w.data[cat] && w.data[cat][item] && w.data[cat][item][day]) || 0
        );
      });
      const day_ma = {};
      Object.entries(day_weekly).forEach(([day, arr]) => {
        day_ma[day] = rollingAvg(arr).map((v) => Math.round(v * 100) / 100);
      });

      const total_weekly = weeksSorted.map((w, i) => {
        let sum = 0;
        Object.values(day_weekly).forEach((arr) => (sum += arr[i]));
        return Math.round(sum * 10) / 10;
      });
      const total_ma = rollingAvg(total_weekly).map((v) => Math.round(v * 100) / 100);

      let forecast_med = [0, 0, 0, 0], forecast_low = [0, 0, 0, 0], forecast_high = [0, 0, 0, 0], forecast_slope = 0;
      if (n >= 2) {
        const { forecasts, residStd, slope } = linregForecast(total_weekly, 4);
        forecast_slope = Math.round(slope * 100) / 100;
        forecast_med = forecasts.map((f) => Math.max(0, Math.round(f * 10) / 10));
        forecast_low = forecast_med.map((m) => {
          const band = Math.max(residStd, 0.08 * m);
          return Math.max(0, Math.round((m - band) * 10) / 10);
        });
        forecast_high = forecast_med.map((m) => {
          const band = Math.max(residStd, 0.08 * m);
          return Math.round((m + band) * 10) / 10;
        });
      }

      // Per-day-of-week forecast: same method, run separately on each day's own
      // weekly series, so "next Saturday" gets its own low/medium/high instead of
      // just an even split of the item's total forecast.
      const day_forecast = {};
      Object.entries(day_weekly).forEach(([day, arr]) => {
        let med = [0, 0, 0, 0], low = [0, 0, 0, 0], high = [0, 0, 0, 0], dslope = 0;
        if (n >= 2) {
          const { forecasts: dForecasts, residStd: dResidStd, slope: dSlope } = linregForecast(arr, 4);
          dslope = Math.round(dSlope * 100) / 100;
          med = dForecasts.map((f) => Math.max(0, Math.round(f * 10) / 10));
          low = med.map((m) => {
            const band = Math.max(dResidStd, 0.08 * m);
            return Math.max(0, Math.round((m - band) * 10) / 10);
          });
          high = med.map((m) => {
            const band = Math.max(dResidStd, 0.08 * m);
            return Math.round((m + band) * 10) / 10;
          });
        }
        day_forecast[day] = { med, low, high, slope: dslope };
      });

      buckets[cat][item] = { day_ma, day_weekly, total_ma, total_weekly, forecast_med, forecast_low, forecast_high, forecast_slope, day_forecast };
    });
  });

  return { labels, forecastLabels, buckets, nWeeks: n, weekISOs: weeksSorted.map((w) => w.date) };
}

// Categories with only ONE number per week (no day-of-week breakdown) share
// this computation: an all-time ranking and a per-week breakdown, so the
// dashboard can show either "most popular overall" or "most popular this
// specific week." Used for Breakfast & Lunch and After 2PM.
function computeSimplePopularity(weeksSorted, categoryKey) {
  const totals = {};
  const byWeek = weeksSorted.map((w) => {
    const catData = w.data[categoryKey] || {};
    Object.entries(catData).forEach(([item, qty]) => {
      totals[item] = (totals[item] || 0) + qty;
    });
    const items = Object.entries(catData)
      .map(([item, qty]) => ({ item, total: Math.round(qty * 10) / 10 }))
      .sort((a, b) => b.total - a.total);
    return { date: w.date, label: formatDateLabel(w.date), items };
  });
  const total = Object.entries(totals)
    .map(([item, t]) => ({ item, total: Math.round(t * 10) / 10 }))
    .sort((a, b) => b.total - a.total);
  return { total, byWeek };
}

function strongestWeakestDay(dayMa) {
  let best = null, bestVal = -Infinity;
  let worst = null, worstVal = Infinity;
  Object.entries(dayMa).forEach(([day, arr]) => {
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    if (avg > bestVal) { bestVal = avg; best = day; }
    if (avg < worstVal) { worstVal = avg; worst = day; }
  });
  return { best, bestVal, worst, worstVal };
}

function generateParagraph(name, entry, labels, forecastLabels) {
  const arr = entry.total_ma;
  const first = arr[0];
  const last = arr[arr.length - 1];
  const diff = last - first;
  const pct = first !== 0 ? (diff / first) * 100 : null;
  const { best, bestVal, worst, worstVal } = strongestWeakestDay(entry.day_ma);

  let trendWord = "held roughly steady";
  if (pct !== null) {
    if (pct > 8) trendWord = "climbed";
    else if (pct < -8) trendWord = "eased back";
  } else if (diff > 0) trendWord = "climbed";
  else if (diff < 0) trendWord = "eased back";

  const pctText = pct !== null
    ? `${pct >= 0 ? "up" : "down"} ${Math.abs(pct).toFixed(0)}%`
    : `a change of ${diff >= 0 ? "+" : ""}${diff.toFixed(1)} units`;

  const rangeText = labels.length > 1 ? `from the week of ${labels[0]} to the week of ${labels[labels.length - 1]}` : "so far";

  // Find the busiest and softest forecasted day specifically for next week (first forecast column).
  const daysWithForecast = Object.keys(entry.day_forecast);
  let nextBusiest = null, nextBusiestVal = -Infinity;
  let nextSoftest = null, nextSoftestVal = Infinity;
  daysWithForecast.forEach((day) => {
    const v = entry.day_forecast[day].med[0];
    if (v > nextBusiestVal) { nextBusiestVal = v; nextBusiest = day; }
    if (v < nextSoftestVal) { nextSoftestVal = v; nextSoftest = day; }
  });
  const nextWeekLabel = forecastLabels && forecastLabels.length > 0 ? forecastLabels[0] : null;

  let forecastSentence = "";
  if (nextWeekLabel && nextBusiest) {
    forecastSentence = ` For the week of ${nextWeekLabel}, expect the most demand on ${nextBusiest} (around ${nextBusiestVal.toFixed(1)} units) and the least on ${nextSoftest} (around ${nextSoftestVal.toFixed(1)} units) \u2014 see the production table below for both of the next 2 weeks, day by day.`;
  }

  return `${name} ${trendWord} ${rangeText}, from about ${Math.round(first)} to ${Math.round(last)} units per week (${pctText}). Historically, ${best} has been the strongest day for this item (around ${bestVal.toFixed(1)} units) and ${worst} the softest (around ${worstVal.toFixed(1)} units).${forecastSentence}`;
}

function CustomTooltip({ active, payload, label, forecastLabels }) {
  if (!active || !payload || !payload.length) return null;
  const isForecast = forecastLabels.includes(label);
  const seen = new Set();
  const rows = [];
  payload.forEach((p) => {
    if (p.dataKey.includes("__band")) return;
    const baseName = p.dataKey.replace("__fc", "");
    if (seen.has(baseName)) return;
    seen.add(baseName);
    if (p.value == null) return;
    rows.push({ name: baseName, value: p.value, color: p.color });
  });
  rows.sort((a, b) => b.value - a.value);

  return React.createElement("div", {
    style: { background: "#FFFFFF", border: "1px solid #E8B9BC", borderRadius: 6, padding: "10px 14px", boxShadow: "0 4px 14px rgba(0,0,0,0.15)", fontFamily: "'Inter', sans-serif" }
  },
    React.createElement("div", { style: { fontWeight: 700, color: "#1A1A1A", marginBottom: 6, fontSize: 12.5 } }, `${isForecast ? "Forecast (medium)" : "3-Wk Avg"} — ${label}`),
    rows.map((r) => React.createElement("div", {
      key: r.name,
      style: { fontSize: 12, color: "#1A1A1A", display: "flex", justifyContent: "space-between", gap: 16 }
    },
      React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 6 } },
        React.createElement("span", { style: { width: 8, height: 8, borderRadius: 99, background: r.color, display: "inline-block" } }),
        r.name
      ),
      React.createElement("span", { style: { fontWeight: 600 } }, r.value?.toFixed(1))
    ))
  );
}

function ForecastTable({ entry, forecastLabels, days }) {
  const weekLabels = forecastLabels.slice(0, 2);
  return React.createElement("div", { style: { overflowX: "auto", marginTop: 8 } },
    React.createElement("table", { style: { borderCollapse: "collapse", width: "100%", fontSize: 12.5 } },
      React.createElement("thead", null,
        React.createElement("tr", null,
          React.createElement("th", { style: { textAlign: "left", padding: "6px 10px", color: "#4D4D4D", fontWeight: 600, borderBottom: "1.5px solid #E8B9BC" } }, "Day"),
          weekLabels.map((label, i) => React.createElement("th", { key: i, style: { textAlign: "right", padding: "6px 10px", color: "#4D4D4D", fontWeight: 600, borderBottom: "1.5px solid #E8B9BC" } }, `Week of ${label}`))
        )
      ),
      React.createElement("tbody", null,
        days.map((day) => React.createElement("tr", { key: day },
          React.createElement("td", { style: { padding: "6px 10px", color: "#1A1A1A", fontWeight: 500 } }, day),
          weekLabels.map((_, i) => React.createElement("td", { key: i, style: { padding: "6px 10px", textAlign: "right", color: "#1A1A1A", fontWeight: 600 } }, entry.day_forecast[day].med[i].toFixed(1)))
        )),
        React.createElement("tr", null,
          React.createElement("td", { style: { padding: "7px 10px", color: "#1A1A1A", fontWeight: 700, borderTop: "1.5px solid #E8B9BC" } }, "Total"),
          weekLabels.map((_, i) => React.createElement("td", { key: i, style: { padding: "7px 10px", textAlign: "right", color: "#1A1A1A", fontWeight: 700, borderTop: "1.5px solid #E8B9BC" } }, entry.forecast_med[i].toFixed(1)))
        )
      )
    )
  );
}

// One tiny, single-line chart for one item on one specific day of week.
// X-axis shows the exact date of each occurrence (e.g. the actual Wednesdays),
// not the week's Monday start date — no color-decoding needed since there's
// only ever one line here.
// Option A: mini chart per day of week, bars instead of a line, same exact-date
// x-axis labels as before. Answers "is this day trending up or down over time?"
// One bar chart per item, one bar per day of week (Mon-Sun), showing each
// day's CURRENT 3-week moving average side by side. This is the primary view:
// "which days does this item sell best on, right now?"
// Horizontal bar chart ranking items by total units sold across the loaded
// weeks — most popular at the top. Used for any category that only has a
// flat weekly total (Breakfast & Lunch, After 2PM) rather than a day-of-week
// breakdown.
const SIMPLE_COLORS = { "Breakfast & Lunch": "#8B1A1F", "After 2PM": "#C41230" };
function PopularityBarChart({ items, color }) {
  const height = Math.max(220, items.length * 28 + 40);
  return React.createElement(ResponsiveContainer, { width: "100%", height },
    React.createElement(BarChart, {
      data: items, layout: "vertical", margin: { top: 4, right: 30, left: 4, bottom: 4 }
    },
      React.createElement(CartesianGrid, { stroke: "#F4DCDD", strokeDasharray: "0", horizontal: false }),
      React.createElement(XAxis, { type: "number", tick: { fill: "#4D4D4D", fontSize: 11.5 }, axisLine: { stroke: "#E8B9BC" }, tickLine: false }),
      React.createElement(YAxis, { type: "category", dataKey: "item", width: 190, tick: { fill: "#1A1A1A", fontSize: 12 }, axisLine: false, tickLine: false }),
      React.createElement(Tooltip, {
        contentStyle: { background: "#FFFFFF", border: "1px solid #E8B9BC", borderRadius: 6, fontSize: 12, fontFamily: "'Inter', sans-serif" },
        labelStyle: { color: "#1A1A1A", fontWeight: 700 },
        cursor: { fill: "#F4DCDD", opacity: 0.5 },
        formatter: (v) => [v?.toFixed(1) + " units total", "Sold"],
      }),
      React.createElement(Bar, { dataKey: "total", fill: color, radius: [0, 4, 4, 0], isAnimationActive: false })
    )
  );
}

// The hourly demand curve: one line per day of week, genuinely distinct
// colors, average net sales by hour, plus a short generated read of what
// the chart is actually showing for this location.
// Forecasting: low/medium/high for a chosen item — by day of week (next
// week), the week's total, and — for desserts specifically, since that's
// the most waste-sensitive category — a 4-week (month) total too.
function ForecastRow({ label, low, med, high, bold }) {
  return React.createElement("div", {
    style: {
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: bold ? "10px 14px" : "7px 14px",
      background: bold ? "#C412301A" : "#F9F0F0",
      borderRadius: 8,
    }
  },
    React.createElement("span", { style: { color: "#1A1A1A", fontWeight: bold ? 700 : 500, fontSize: bold ? 13.5 : 12.5 } }, label),
    React.createElement("div", { style: { display: "flex", gap: 14, fontSize: bold ? 13.5 : 12.5 } },
      React.createElement("span", { style: { color: "#7A7A7A", minWidth: 54, textAlign: "right" } }, `Low ${low.toFixed(0)}`),
      React.createElement("span", { style: { color: "#C41230", fontWeight: 700, minWidth: 60, textAlign: "right" } }, `Med ${med.toFixed(0)}`),
      React.createElement("span", { style: { color: "#7A7A7A", minWidth: 58, textAlign: "right" } }, `High ${high.toFixed(0)}`)
    )
  );
}

function ForecastingView({ location, derived, forecastCategory, setForecastCategory, forecastItem, setForecastItem }) {
  const items = derived.buckets[forecastCategory] || {};
  const itemNames = Object.keys(items).sort((a, b) => itemTotalVolume(items[b]) - itemTotalVolume(items[a]));
  const entry = forecastItem ? items[forecastItem] : null;
  const nextWeekLabel = derived.forecastLabels[0];
  const days = entry ? DAY_ORDER.filter((d) => entry.day_forecast[d]) : [];

  const monthMed = entry ? entry.forecast_med.reduce((a, b) => a + b, 0) : 0;
  const monthLow = entry ? entry.forecast_low.reduce((a, b) => a + b, 0) : 0;
  const monthHigh = entry ? entry.forecast_high.reduce((a, b) => a + b, 0) : 0;

  return React.createElement(React.Fragment, null,
    React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 18 } },
      DAY_CATEGORIES.map((cat) => React.createElement("div", {
        key: cat, className: "lq-cat-tab",
        onClick: () => { setForecastCategory(cat); setForecastItem(null); },
        style: {
          padding: "9px 20px", borderRadius: 999, fontSize: 13.5, fontWeight: 600, fontFamily: "'Fraunces', serif", cursor: "pointer",
          background: forecastCategory === cat ? "#1A1A1A" : "#FFFFFF",
          color: forecastCategory === cat ? "#FFFFFF" : "#333333",
          border: `1.5px solid ${forecastCategory === cat ? "#1A1A1A" : "#E8B9BC"}`,
        }
      }, cat))
    ),
    React.createElement("div", { style: { background: "#FFFFFF", border: "1px solid #E8B9BC", borderRadius: 14, padding: "18px 20px", marginBottom: 18 } },
      React.createElement("div", { style: { fontSize: 12.5, color: "#4D4D4D", marginBottom: 12 } }, itemNames.length === 0 ? "No items in this category." : "Choose an item to see its forecast."),
      React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 7 } },
        itemNames.map((name) => {
          const active = forecastItem === name;
          return React.createElement("div", {
            key: name, className: "lq-item-chip", onClick: () => setForecastItem(active ? null : name),
            style: {
              display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 500, cursor: "pointer",
              border: `1.5px solid ${active ? "#C41230" : "#E8B9BC"}`,
              background: active ? "#C412301A" : "transparent",
              color: active ? "#1A1A1A" : "#7A7A7A",
            }
          }, name);
        })
      )
    ),
    !entry
      ? React.createElement("div", { style: { background: "#FFFFFF", border: "1px solid #E8B9BC", borderRadius: 14, textAlign: "center", color: "#7A7A7A", padding: "50px 0", fontSize: 13.5 } }, "Select an item above to see its forecast.")
      : React.createElement("div", { style: { background: "#FFFFFF", border: "1px solid #E8B9BC", borderRadius: 14, padding: "20px 20px 18px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" } },
          React.createElement("div", { style: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 16, color: "#1A1A1A", marginBottom: 2 } }, forecastItem),
          React.createElement("div", { style: { fontSize: 11.5, color: "#7A7A7A", marginBottom: 16 } }, `Week of ${nextWeekLabel} — low / medium / high units to make`),

          React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: "#666666", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" } }, "By Day"),
          React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 5, marginBottom: 16 } },
            days.map((day) => {
              const df = entry.day_forecast[day];
              return React.createElement(ForecastRow, { key: day, label: day, low: df.low[0], med: df.med[0], high: df.high[0] });
            })
          ),

          React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: "#666666", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" } }, "Week Total"),
          React.createElement("div", { style: { marginBottom: forecastCategory === "Desserts" ? 16 : 0 } },
            React.createElement(ForecastRow, { label: `Week of ${nextWeekLabel}`, low: entry.forecast_low[0], med: entry.forecast_med[0], high: entry.forecast_high[0], bold: true })
          ),

          forecastCategory === "Desserts" && React.createElement(React.Fragment, null,
            React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: "#666666", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" } }, "Month Total (next 4 weeks combined)"),
            React.createElement(ForecastRow, { label: "4-Week Total", low: monthLow, med: monthMed, high: monthHigh, bold: true }),
            React.createElement("div", { style: { fontSize: 10.5, color: "#9C9C9C", marginTop: 8 } }, "Desserts get a longer view here since they're the most waste-sensitive category — a bad single-week estimate is more costly than for bread or pastry.")
          )
        )
  );
}

function HourlyDemandChart({ location, hourlyDays, visibleHourlyDays, onToggleHourlyDay }) {
  if (hourlyDays.length === 0) {
    return React.createElement("div", {
      style: { background: "#FFFFFF", border: "1.5px dashed #E8B9BC", borderRadius: 14, padding: "40px 30px", textAlign: "center" }
    },
      React.createElement("div", { style: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 17, color: "#1A1A1A", marginBottom: 8 } }, `No hourly data for ${location}`),
      React.createElement("p", { style: { fontSize: 13.5, color: "#333333", maxWidth: 480, margin: "0 auto", lineHeight: 1.6 } },
        `Add a data/${location.toLowerCase()}_hourly.json file (built from Toast's Sales Summary "Time of day" and "Day of week" reports, one day at a time) to populate this.`
      )
    );
  }

  const { curve, hoursSorted, daysPresent } = buildHourlyCurve(hourlyDays);
  const chartDays = daysPresent.filter((d) => visibleHourlyDays.has(d));
  const chartData = hoursSorted.map((h) => {
    const row = { hour: formatHour(h) };
    chartDays.forEach((day) => {
      row[day] = curve[day][h] !== undefined ? curve[day][h] : null;
    });
    return row;
  });
  const description = generateHourlyDescription(location, curve, hoursSorted, daysPresent);

  return React.createElement(React.Fragment, null,
    React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 16 } },
      daysPresent.map((day) => {
        const on = visibleHourlyDays.has(day);
        const color = HOURLY_DAY_COLORS[day];
        return React.createElement("div", {
          key: day, className: "lq-item-chip", onClick: () => onToggleHourlyDay(day),
          style: {
            display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 500, cursor: "pointer",
            border: `1.5px solid ${on ? color : "#E8B9BC"}`,
            background: on ? `${color}1A` : "transparent",
            color: on ? "#1A1A1A" : "#7A7A7A",
          }
        },
          React.createElement("span", { style: { width: 8, height: 8, borderRadius: 99, background: on ? color : "#E8B9BC", display: "inline-block" } }),
          day
        );
      })
    ),
    React.createElement("div", { style: { background: "#FFFFFF", border: "1px solid #E8B9BC", borderRadius: 14, padding: "20px 20px 8px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", marginBottom: 14 } },
      React.createElement("div", { style: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 15, color: "#1A1A1A", marginBottom: 12 } }, `${location} — Average Net Sales by Hour`),
      chartDays.length === 0
        ? React.createElement("div", { style: { textAlign: "center", color: "#7A7A7A", padding: "50px 0", fontSize: 12.5 } }, "No days selected — use the day filter above.")
        : React.createElement(ResponsiveContainer, { width: "100%", height: 340 },
            React.createElement(LineChart, { data: chartData, margin: { top: 5, right: 16, left: -6, bottom: 5 } },
              React.createElement(CartesianGrid, { stroke: "#F4DCDD", strokeDasharray: "0", vertical: false }),
              React.createElement(XAxis, { dataKey: "hour", tick: { fill: "#4D4D4D", fontSize: 11.5 }, axisLine: { stroke: "#E8B9BC" }, tickLine: false }),
              React.createElement(YAxis, { tick: { fill: "#4D4D4D", fontSize: 11.5 }, axisLine: false, tickLine: false, width: 46 }),
              React.createElement(Tooltip, {
                contentStyle: { background: "#FFFFFF", border: "1px solid #E8B9BC", borderRadius: 6, fontSize: 12, fontFamily: "'Inter', sans-serif" },
                labelStyle: { color: "#1A1A1A", fontWeight: 700 },
                formatter: (v, name) => [v != null ? `$${v.toFixed(0)}` : "—", name],
              }),
              React.createElement(Legend, { wrapperStyle: { fontSize: 12, paddingTop: 10 } }),
              chartDays.map((day) => React.createElement(Line, {
                key: day, type: "monotone", dataKey: day, name: day,
                stroke: HOURLY_DAY_COLORS[day], strokeWidth: 2.25,
                dot: { r: 2.5, strokeWidth: 0 }, activeDot: { r: 5 },
                isAnimationActive: false, connectNulls: false,
              }))
            )
          )
    ),
    React.createElement("p", { style: { fontSize: 13, lineHeight: 1.6, color: "#333333", margin: "0 0 4px" } }, description)
  );
}

function SnapshotBarChart({ entry, days }) {
  const data = days.map((day) => ({
    day: day.slice(0, 3),
    fullDay: day,
    value: entry.day_ma[day][entry.day_ma[day].length - 1],
  }));
  return React.createElement(ResponsiveContainer, { width: "100%", height: 200 },
    React.createElement(BarChart, { data, margin: { top: 8, right: 12, left: -10, bottom: 0 } },
      React.createElement(CartesianGrid, { stroke: "#F4DCDD", strokeDasharray: "0", vertical: false }),
      React.createElement(XAxis, { dataKey: "day", tick: { fill: "#4D4D4D", fontSize: 12 }, axisLine: { stroke: "#E8B9BC" }, tickLine: false }),
      React.createElement(YAxis, { tick: { fill: "#4D4D4D", fontSize: 11.5 }, axisLine: false, tickLine: false, width: 34 }),
      React.createElement(Tooltip, {
        contentStyle: { background: "#FFFFFF", border: "1px solid #E8B9BC", borderRadius: 6, fontSize: 12, fontFamily: "'Inter', sans-serif" },
        labelStyle: { color: "#1A1A1A", fontWeight: 700 },
        cursor: { fill: "#F4DCDD", opacity: 0.5 },
        formatter: (v, n, p) => [v?.toFixed(1), p.payload.fullDay],
      }),
      React.createElement(Bar, {
        dataKey: "value", radius: [4, 4, 0, 0], isAnimationActive: false,
        shape: (props) => {
          const { x, y, width, height, payload } = props;
          return React.createElement("rect", { x, y, width, height, rx: 4, ry: 4, fill: DAY_COLORS[payload.fullDay] });
        },
      })
    )
  );
}

// One item's full section: name, then its day-of-week snapshot bar chart.
function ItemDayRow({ name, entry, visibleDays }) {
  const days = DAY_ORDER.filter((d) => entry.day_ma[d] && visibleDays.has(d));

  return React.createElement("div", {
    className: "lq-day-card",
    style: { background: "#FFFFFF", border: "1px solid #E8B9BC", borderRadius: 14, padding: "18px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }
  },
    React.createElement("div", { style: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 16, color: "#1A1A1A", marginBottom: 2 } }, name),
    React.createElement("div", { style: { fontSize: 11.5, color: "#666666", marginBottom: 12 } }, "Current 3-week moving average, side by side by day of week"),
    days.length === 0
      ? React.createElement("div", { style: { textAlign: "center", color: "#7A7A7A", padding: "30px 0", fontSize: 12.5 } }, "No days selected — use the day filter above.")
      : React.createElement(SnapshotBarChart, { entry, days })
  );
}

function ItemDetailCard({ name, entry, color, labels, forecastLabels }) {
  const paragraph = useMemo(() => generateParagraph(name, entry, labels, forecastLabels), [name, entry, labels, forecastLabels]);
  const days = DAY_ORDER.filter((d) => entry.day_ma[d]);

  return React.createElement("div", {
    style: { background: "#FFFFFF", border: `1.5px solid ${color}55`, borderLeft: `5px solid ${color}`, borderRadius: 10, padding: "16px 18px" }
  },
    React.createElement("div", { style: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 15, color: "#1A1A1A", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 } },
      React.createElement("span", { style: { width: 10, height: 10, borderRadius: 99, background: color, display: "inline-block" } }),
      name
    ),
    React.createElement("p", { style: { fontSize: 13, lineHeight: 1.6, color: "#1A1A1A", margin: "0 0 6px" } }, paragraph),
    React.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, color: "#4D4D4D", marginTop: 12, textTransform: "uppercase", letterSpacing: "0.05em" } }, "3-Wk Moving Avg by Day"),
    React.createElement("div", { style: { fontSize: 10.5, color: "#666666", marginBottom: 4 } }, "Each column is one calendar week (Mon\u2013Sun), starting on the date shown. Rows are that week's actual numbers for each day."),
    React.createElement("div", { style: { overflowX: "auto" } },
      React.createElement("table", { style: { borderCollapse: "collapse", width: "100%", fontSize: 11.5 } },
        React.createElement("thead", null,
          React.createElement("tr", null,
            React.createElement("th", { style: { textAlign: "left", padding: "5px 8px", color: "#4D4D4D", fontWeight: 600, borderBottom: "1.5px solid #E8B9BC" } }, "Day"),
            labels.map((label) => React.createElement("th", { key: label, style: { textAlign: "right", padding: "5px 8px", color: "#4D4D4D", fontWeight: 600, borderBottom: "1.5px solid #E8B9BC" } }, `Week of ${label}`))
          )
        ),
        React.createElement("tbody", null,
          days.map((day) => React.createElement("tr", { key: day },
            React.createElement("td", { style: { padding: "4px 8px", color: "#1A1A1A", fontWeight: 500 } }, day),
            entry.day_ma[day].map((v, i) => React.createElement("td", { key: i, style: { padding: "4px 8px", textAlign: "right", color: "#1A1A1A" } }, v.toFixed(1)))
          )),
          React.createElement("tr", null,
            React.createElement("td", { style: { padding: "5px 8px", color: "#1A1A1A", fontWeight: 700, borderTop: "1.5px solid #E8B9BC" } }, "Total"),
            entry.total_ma.map((v, i) => React.createElement("td", { key: i, style: { padding: "5px 8px", textAlign: "right", color: "#1A1A1A", fontWeight: 700, borderTop: "1.5px solid #E8B9BC" } }, v.toFixed(1)))
          )
        )
      )
    ),
    React.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, color: "#4D4D4D", marginTop: 14, textTransform: "uppercase", letterSpacing: "0.05em" } }, "Production Estimate — Next 2 Weeks, by Day"),
    React.createElement(ForecastTable, { entry, forecastLabels, days })
  );
}

// One consistent color per day of week, used everywhere a chart breaks data
// out by day — so "Saturday" is always the same color across every item's
// chart, every category, every location.
const DAY_COLORS = {
  Monday: "#1A1A1A",
  Tuesday: "#5C0F16",
  Wednesday: "#8B1A1F",
  Thursday: "#C41230",
  Friday: "#E0435A",
  Saturday: "#EF8080",
  Sunday: "#F4B8BE",
};

// The hourly demand curve overlays up to 7 lines on one chart, so it needs
// genuinely distinct colors per day rather than the red-shade family used
// elsewhere — shades of one hue are hard to tell apart when they're
// crossing and overlapping in a real line chart.
const HOURLY_DAY_COLORS = {
  Mon: "#C41230",
  Tue: "#1A6FA8",
  Wed: "#1A8B4A",
  Thu: "#B8860B",
  Fri: "#6E3AA8",
  Sat: "#1A1A1A",
  Sun: "#D97706",
};
const HOURLY_DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

async function loadWeeksForLocation(loc) {
  try {
    const res = await fetch(LOCATION_FILES[loc], { cache: "no-store" });
    if (!res.ok) return [];
    const weeks = await res.json();
    weeks.sort((a, b) => a.date.localeCompare(b.date));
    return weeks;
  } catch (e) {
    return [];
  }
}

async function loadHourlyForLocation(loc) {
  try {
    const res = await fetch(HOURLY_FILES[loc], { cache: "no-store" });
    if (!res.ok) return [];
    const days = await res.json();
    return days;
  } catch (e) {
    return [];
  }
}

// Multiple weeks of hourly data get averaged together per day-of-week, so
// "Monday" is one clean line (averaged across however many Mondays are in
// the data) instead of a separate line per date. Hours only present on some
// days show up as gaps (null), not zeros, so a day that closes early
// doesn't look like it crashes to $0.
function buildHourlyCurve(days) {
  const byDay = {};
  HOURLY_DAY_ORDER.forEach((d) => (byDay[d] = []));
  days.forEach((entry) => {
    if (byDay[entry.day]) byDay[entry.day].push(entry);
  });

  const allHours = new Set();
  days.forEach((entry) => Object.keys(entry.hours).forEach((h) => allHours.add(parseInt(h, 10))));
  const hoursSorted = Array.from(allHours).sort((a, b) => a - b);

  const curve = {};
  HOURLY_DAY_ORDER.forEach((day) => {
    const entries = byDay[day];
    if (entries.length === 0) return;
    const avg = {};
    hoursSorted.forEach((h) => {
      const vals = entries.map((e) => e.hours[h]).filter((v) => v !== undefined);
      if (vals.length > 0) {
        avg[h] = Math.round((vals.reduce((a, v) => a + v.net_sales, 0) / vals.length) * 100) / 100;
      }
    });
    curve[day] = avg;
  });

  return { curve, hoursSorted, daysPresent: HOURLY_DAY_ORDER.filter((d) => curve[d]) };
}

function formatHour(h) {
  const period = h < 12 ? "am" : "pm";
  let display = h % 12;
  if (display === 0) display = 12;
  return `${display}${period}`;
}

// Builds a short, plain-language read of the curve: peak hour, busiest day,
// and whether weekend hours look shorter than weekdays.
function generateHourlyDescription(location, curve, hoursSorted, daysPresent) {
  let peakDay = null, peakHour = null, peakVal = -Infinity;
  const dayTotals = {};
  const dayHourCounts = {};
  daysPresent.forEach((day) => {
    let total = 0, count = 0;
    hoursSorted.forEach((h) => {
      const v = curve[day][h];
      if (v !== undefined) {
        total += v;
        count += 1;
        if (v > peakVal) { peakVal = v; peakDay = day; peakHour = h; }
      }
    });
    dayTotals[day] = total;
    dayHourCounts[day] = count;
  });

  const busiestDay = Object.entries(dayTotals).sort((a, b) => b[1] - a[1])[0];
  const weekdayHourCounts = ["Mon", "Tue", "Wed", "Thu", "Fri"].filter((d) => dayHourCounts[d]).map((d) => dayHourCounts[d]);
  const weekendHourCounts = ["Sat", "Sun"].filter((d) => dayHourCounts[d]).map((d) => dayHourCounts[d]);
  const avgWeekdayHours = weekdayHourCounts.length ? weekdayHourCounts.reduce((a, b) => a + b, 0) / weekdayHourCounts.length : null;
  const avgWeekendHours = weekendHourCounts.length ? weekendHourCounts.reduce((a, b) => a + b, 0) / weekendHourCounts.length : null;

  let weekendNote = "";
  if (avgWeekdayHours !== null && avgWeekendHours !== null && avgWeekendHours < avgWeekdayHours - 1.5) {
    weekendNote = ` Weekend hours run noticeably shorter than weekdays in this data — worth confirming whether that's the store's actual posted hours or just when sales happened to stop.`;
  }

  return `This is average net sales by hour, by day of week, at ${location} — each day's line is averaged across the weeks loaded, not a single date. The single busiest point overall is ${peakDay} at ${formatHour(peakHour)} (around $${peakVal.toFixed(0)}). ${busiestDay[0]} is the highest-earning day overall.${weekendNote}`;
}

// Home page: a quick glance across all 4 locations before drilling into
// any one of them — total units sold and how many weeks of data are
// loaded, so a stale or missing location is obvious at a glance.
function HomeView({ onSelectLocation }) {
  const [summaries, setSummaries] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const results = {};
      for (const loc of LOCATION_NAMES) {
        const weeks = await loadWeeksForLocation(loc);
        let total = 0;
        weeks.forEach((w) => {
          ["Breads", "Pastries", "Desserts"].forEach((cat) => {
            Object.values(w.data[cat] || {}).forEach((days) => {
              Object.values(days).forEach((qty) => (total += qty));
            });
          });
        });
        results[loc] = { weeksLoaded: weeks.length, total: Math.round(total) };
      }
      if (!cancelled) setSummaries(results);
    })();
    return () => { cancelled = true; };
  }, []);

  return React.createElement("div", null,
    React.createElement("h1", { style: { fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 44, lineHeight: 1.1, margin: "0 0 8px", color: "#1A1A1A" } }, "Le Quartier"),
    React.createElement("p", { style: { fontSize: 14, color: "#333333", margin: "0 0 28px" } }, "Select a location to see its full breakdown, or compare all four here first."),
    !summaries
      ? React.createElement("div", { style: { textAlign: "center", color: "#7A7A7A", padding: "40px 0", fontSize: 13.5 } }, "Loading locations\u2026")
      : React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 } },
          LOCATION_NAMES.map((loc) => {
            const s = summaries[loc];
            const noData = !s || s.weeksLoaded === 0;
            return React.createElement("div", {
              key: loc, className: "lq-day-card", onClick: () => onSelectLocation(loc),
              style: {
                background: "#FFFFFF", border: "2px solid #E8B9BC", borderRadius: 14, padding: "22px 20px", cursor: "pointer",
              }
            },
              React.createElement("div", { style: { fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 20, color: "#1A1A1A", marginBottom: 10 } }, loc),
              noData
                ? React.createElement("div", { style: { fontSize: 12.5, color: "#7A7A7A" } }, "No data loaded yet")
                : React.createElement(React.Fragment, null,
                    React.createElement("div", { style: { fontSize: 26, fontWeight: 700, color: "#C41230", fontFamily: "'Fraunces', serif" } }, s.total.toLocaleString()),
                    React.createElement("div", { style: { fontSize: 12, color: "#666666", marginBottom: 8 } }, "units sold (Bread, Pastry, Dessert)"),
                    React.createElement("div", { style: { fontSize: 12, color: "#7A7A7A" } }, `${s.weeksLoaded} week${s.weeksLoaded === 1 ? "" : "s"} of data loaded`)
                  )
            );
          })
        )
  );
}

function Dashboard({ user, onLogout }) {
  const [showHome, setShowHome] = useState(true);
  const [location, setLocation] = useState("Edgewood");
  const [category, setCategory] = useState("Breads");
  const [activeItems, setActiveItems] = useState(() => new Set(DEFAULT_ACTIVE["Breads"]));
  const [visibleDays, setVisibleDays] = useState(() => new Set(DAY_ORDER));
  const toggleDay = (day) => {
    setVisibleDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day); else next.add(day);
      return next;
    });
  };
  const [weeks, setWeeks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hourlyDays, setHourlyDays] = useState([]);
  const [hourlyLoading, setHourlyLoading] = useState(true);
  const [visibleHourlyDays, setVisibleHourlyDays] = useState(() => new Set(HOURLY_DAY_ORDER));
  const [forecastCategory, setForecastCategory] = useState("Breads");
  const [forecastItem, setForecastItem] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const w = await loadWeeksForLocation(location);
      if (!cancelled) { setWeeks(w); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [location]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setHourlyLoading(true);
      const h = await loadHourlyForLocation(location);
      if (!cancelled) {
        setHourlyDays(h);
        setHourlyLoading(false);
        setVisibleHourlyDays(new Set(HOURLY_DAY_ORDER));
      }
    })();
    return () => { cancelled = true; };
  }, [location]);

  const toggleHourlyDay = (day) => {
    setVisibleHourlyDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day); else next.add(day);
      return next;
    });
  };

  const derived = useMemo(() => computeAllDerived(weeks), [weeks]);
  const hasData = weeks.length > 0;

  const items = hasData ? derived.buckets[category] : null;
  const itemNames = useMemo(
    () => items ? Object.keys(items).sort((a, b) => itemTotalVolume(items[b]) - itemTotalVolume(items[a])) : [],
    [items]
  );

  const colorForItem = useMemo(() => {
    const map = {};
    itemNames.forEach((name, i) => (map[name] = colorForIndex(i)));
    return map;
  }, [itemNames]);

  const switchLocation = (loc) => {
    setShowHome(false);
    setLocation(loc);
    setActiveItems(new Set(DEFAULT_ACTIVE[category] || []));
    setSimpleWeek("total");
    setForecastItem(null);
  };
  const switchCategory = (cat) => {
    setCategory(cat);
    setActiveItems(new Set(DEFAULT_ACTIVE[cat] || []));
    setSimpleWeek("total");
  };
  const toggleItem = (name) => {
    setActiveItems((prev) => (prev.has(name) ? new Set() : new Set([name])));
  };

  const activeList = itemNames.filter((n) => activeItems.has(n));
  const isSimpleCategory = SIMPLE_CATEGORIES.includes(category);
  const simpleData = useMemo(
    () => (isSimpleCategory ? computeSimplePopularity(weeks, category) : { total: [], byWeek: [] }),
    [weeks, category, isSimpleCategory]
  );
  const [simpleWeek, setSimpleWeek] = useState("total");
  const simpleSelected = simpleWeek === "total" ? simpleData.total : (simpleData.byWeek.find((w) => w.date === simpleWeek) || {}).items || [];

  return React.createElement("div", {
    style: { background: "#FFFFFF", minHeight: "100vh", padding: "36px 28px 44px", fontFamily: "'Inter', sans-serif", color: "#1A1A1A" }
  },
    React.createElement("style", null, `
      .lq-loc-tab, .lq-cat-tab, .lq-item-chip { transition: all 0.15s ease; }
      .lq-loc-tab:hover, .lq-cat-tab:hover { transform: translateY(-1px); filter: brightness(1.04); }
      .lq-item-chip:hover { transform: translateY(-1px); box-shadow: 0 2px 6px rgba(0,0,0,0.10); }
      .lq-day-card { transition: box-shadow 0.15s ease, transform 0.15s ease; }
      .lq-day-card:hover { box-shadow: 0 4px 14px rgba(0,0,0,0.12); transform: translateY(-2px); }
      .lq-logout:hover { color: #8B1A1F; }
    `),
    React.createElement("div", { style: { maxWidth: 1080, margin: "0 auto" } },
      React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 } },
        React.createElement("div", {
          className: "lq-item-chip", onClick: () => setShowHome(true),
          style: {
            display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
            border: `1.5px solid ${showHome ? "#C41230" : "#E8B9BC"}`,
            background: showHome ? "#C412301A" : "transparent",
            color: showHome ? "#C41230" : "#333333",
          }
        }, "\u2302 Home"),
        React.createElement("span", { style: { fontSize: 12, color: "#4D4D4D" } },
          "Signed in as ", React.createElement("strong", { style: { color: "#1A1A1A" } }, user.displayName), " \u00b7 ",
          React.createElement("span", { className: "lq-logout", onClick: onLogout, style: { color: "#C41230", cursor: "pointer", textDecoration: "underline" } }, "Log out")
        )
      ),
      showHome
        ? React.createElement(HomeView, { onSelectLocation: switchLocation })
        : React.createElement(React.Fragment, null,
      React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" } },
        LOCATION_NAMES.map((loc) => React.createElement("div", {
          key: loc, className: "lq-loc-tab", onClick: () => switchLocation(loc),
          style: {
            padding: "16px 36px", borderRadius: 12, fontSize: 19, fontWeight: 700, fontFamily: "'Fraunces', serif", cursor: "pointer",
            background: location === loc ? "#C41230" : "#FFFFFF",
            color: location === loc ? "#FFFFFF" : "#333333",
            border: `2px solid ${location === loc ? "#C41230" : "#E8B9BC"}`,
            boxShadow: location === loc ? "0 3px 10px rgba(196,18,48,0.35)" : "none",
          }
        }, loc))
      ),
      React.createElement("h1", { style: { fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 44, lineHeight: 1.1, margin: "0 0 26px", color: "#1A1A1A" } }, location),

      loading ? React.createElement("div", { style: { textAlign: "center", color: "#7A7A7A", padding: "40px 0", fontSize: 13.5 } }, `Loading ${location}'s data\u2026`)
      : !hasData ? React.createElement("div", {
          style: { background: "#FFFFFF", border: "1.5px dashed #E8B9BC", borderRadius: 14, padding: "40px 30px", textAlign: "center" }
        },
          React.createElement("div", { style: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 18, color: "#1A1A1A", marginBottom: 8 } }, `No data yet for ${location}`),
          React.createElement("p", { style: { fontSize: 13.5, color: "#333333", maxWidth: 460, margin: "0 auto", lineHeight: 1.6 } },
            `Add a data/${location.toLowerCase()}.json file (same format as Edgewood) and push it to the repo to populate this tab.`
          )
        )
      : React.createElement(React.Fragment, null,
          React.createElement("div", { style: { fontSize: 12.5, color: "#4D4D4D", marginBottom: 18 } }, `${weeks.length} week${weeks.length === 1 ? "" : "s"} of data loaded`),

          React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 22 } },
            TAB_CATEGORIES.map((cat) => React.createElement("div", {
              key: cat, className: "lq-cat-tab", onClick: () => switchCategory(cat),
              style: {
                padding: "9px 20px", borderRadius: 999, fontSize: 13.5, fontWeight: 600, fontFamily: "'Fraunces', serif", cursor: "pointer",
                background: category === cat ? "#1A1A1A" : "#FFFFFF",
                color: category === cat ? "#FFFFFF" : "#333333",
                border: `1.5px solid ${category === cat ? "#1A1A1A" : "#E8B9BC"}`,
              }
            }, cat))
          ),

          category === "Forecasting"
            ? React.createElement(ForecastingView, {
                location, derived, forecastCategory, setForecastCategory, forecastItem, setForecastItem,
              })
            : category === "Hourly Demand"
            ? hourlyLoading
              ? React.createElement("div", { style: { textAlign: "center", color: "#7A7A7A", padding: "40px 0", fontSize: 13.5 } }, `Loading ${location}'s hourly data\u2026`)
              : React.createElement(HourlyDemandChart, {
                  location, hourlyDays, visibleHourlyDays, onToggleHourlyDay: toggleHourlyDay,
                })
            : isSimpleCategory
            ? simpleData.total.length === 0
              ? React.createElement("div", {
                  style: { background: "#FFFFFF", border: "1.5px dashed #E8B9BC", borderRadius: 14, padding: "40px 30px", textAlign: "center" }
                },
                  React.createElement("div", { style: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 17, color: "#1A1A1A", marginBottom: 8 } }, `No ${category} data for ${location}`),
                  React.createElement("p", { style: { fontSize: 13.5, color: "#333333", maxWidth: 480, margin: "0 auto", lineHeight: 1.6 } },
                    category === "Breakfast & Lunch"
                      ? `${location} doesn't tag items as "Breakfast" or "Lunch" in Toast the way Edgewood does — it uses different category names for this kind of menu. Once it's confirmed which of ${location}'s categories are the equivalent, this tab can be filled in the same way.`
                      : `${location} doesn't have an after-2pm export yet. Once that's pulled from Toast (Product Mix report, hour filter set to 2:00 PM–close), this tab will fill in the same way.`
                  )
                )
              : React.createElement(React.Fragment, null,
                  React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 16 } },
                    React.createElement("div", {
                      className: "lq-item-chip", onClick: () => setSimpleWeek("total"),
                      style: {
                        padding: "6px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                        border: `1.5px solid ${simpleWeek === "total" ? SIMPLE_COLORS[category] : "#E8B9BC"}`,
                        background: simpleWeek === "total" ? `${SIMPLE_COLORS[category]}1A` : "transparent",
                        color: simpleWeek === "total" ? "#1A1A1A" : "#7A7A7A",
                      }
                    }, "All Weeks (Total)"),
                    simpleData.byWeek.map((w) => React.createElement("div", {
                      key: w.date, className: "lq-item-chip", onClick: () => setSimpleWeek(w.date),
                      style: {
                        padding: "6px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 500, cursor: "pointer",
                        border: `1.5px solid ${simpleWeek === w.date ? SIMPLE_COLORS[category] : "#E8B9BC"}`,
                        background: simpleWeek === w.date ? `${SIMPLE_COLORS[category]}1A` : "transparent",
                        color: simpleWeek === w.date ? "#1A1A1A" : "#7A7A7A",
                      }
                    }, `Week of ${w.label}`))
                  ),
                  React.createElement("div", { style: { background: "#FFFFFF", border: "1px solid #E8B9BC", borderRadius: 14, padding: "20px 20px 8px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" } },
                    React.createElement("div", { style: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 15, color: "#1A1A1A", marginBottom: 2 } }, category === "After 2PM" ? "Most Popular After 2PM" : "Most Popular Items"),
                    React.createElement("div", { style: { fontSize: 11.5, color: "#666666", marginBottom: 14 } },
                      simpleWeek === "total"
                        ? `Total units sold, all ${weeks.length} loaded weeks combined — no day-of-week breakdown available for this category yet.`
                        : `Units sold the week of ${simpleData.byWeek.find((w) => w.date === simpleWeek)?.label} only.`
                    ),
                    simpleSelected.length === 0
                      ? React.createElement("div", { style: { textAlign: "center", color: "#7A7A7A", padding: "30px 0", fontSize: 12.5 } }, "No items recorded for this week.")
                      : React.createElement(PopularityBarChart, { items: simpleSelected, color: SIMPLE_COLORS[category] })
                  )
                )
            : React.createElement(React.Fragment, null,
                React.createElement("div", { style: { background: "#FFFFFF", border: "1px solid #E8B9BC", borderRadius: 14, padding: "18px 20px", marginBottom: 18 } },
                  React.createElement("div", { style: { fontSize: 12.5, color: "#4D4D4D", marginBottom: 12 } }, `${activeItems.size} of ${itemNames.length} items on the chart.`),
                  React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 7 } },
                    itemNames.map((name) => {
                      const active = activeItems.has(name);
                      const color = colorForItem[name];
                      return React.createElement("div", {
                        key: name, className: "lq-item-chip", onClick: () => toggleItem(name),
                        style: {
                          display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 500, cursor: "pointer",
                          border: `1.5px solid ${active ? color : "#E8B9BC"}`,
                          background: active ? `${color}1A` : "transparent",
                          color: active ? "#1A1A1A" : "#7A7A7A",
                        }
                      },
                        React.createElement("span", { style: { width: 8, height: 8, borderRadius: 99, background: active ? color : "#E8B9BC", display: "inline-block" } }),
                        name
                      );
                    })
                  )
                ),

                React.createElement("div", { style: { marginBottom: 4 } },
                  React.createElement("div", { style: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 15, color: "#1A1A1A" } }, "3-Week Moving Average — by Item, by Day of Week"),
                  React.createElement("div", { style: { fontSize: 12, color: "#4D4D4D", marginBottom: 14, maxWidth: 700, lineHeight: 1.5 } },
                    "The 4-week forecast (low/medium/high) is in the numbers table below each item, not on the chart, to keep these simple."
                  )
                ),

                React.createElement("div", { style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px", marginBottom: 18 } },
                  React.createElement("span", { style: { fontSize: 11.5, color: "#4D4D4D", fontWeight: 600 } }, "Show days:"),
                  DAY_ORDER.map((day) => {
                    const on = visibleDays.has(day);
                    return React.createElement("div", {
                      key: day, className: "lq-item-chip", onClick: () => toggleDay(day),
                      style: {
                        display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 500, cursor: "pointer",
                        border: `1.5px solid ${on ? DAY_COLORS[day] : "#E8B9BC"}`,
                        background: on ? `${DAY_COLORS[day]}1A` : "transparent",
                        color: on ? "#1A1A1A" : "#7A7A7A",
                      }
                    },
                      React.createElement("span", { style: { width: 7, height: 7, borderRadius: 99, background: on ? DAY_COLORS[day] : "#E8B9BC", display: "inline-block" } }),
                      day.slice(0, 3)
                    );
                  })
                ),

                activeList.length === 0
                  ? React.createElement("div", { style: { background: "#FFFFFF", border: "1px solid #E8B9BC", borderRadius: 14, textAlign: "center", color: "#7A7A7A", padding: "60px 0", fontSize: 13.5, marginBottom: 22 } }, "Select an item above to see its day-of-week trend.")
                  : React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14, marginBottom: 22 } },
                      activeList.map((name) => React.createElement(ItemDayRow, {
                        key: name, name, entry: items[name], visibleDays,
                      }))
                    ),

                activeList.length > 0 && React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14 } },
                  activeList.map((name) => React.createElement(ItemDetailCard, {
                    key: name, name, entry: items[name], color: colorForItem[name], labels: derived.labels, forecastLabels: derived.forecastLabels
                  }))
                )
              ),

          React.createElement("div", { style: { fontSize: 11, color: "#7A7A7A", marginTop: 26, textAlign: "center" } },
            `Source: Toast Product Mix (PMIX) exports, ${location} location, weekly Mon\u2013Sun totals. Forecasts use a simple linear trend fit to the available weeks; low/high bands reflect historical week-to-week variability. Bagels are grouped under Pastries.`
          )
        )
      )
    )
  );
}

function LoginScreen({ onSuccess }) {
  const [username, setUsername] = useState("");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    const match = CREDENTIALS.find(
      (c) => c.username.toLowerCase() === username.trim().toLowerCase() && c.passcode === passcode.trim()
    );
    if (!match) { setError("Username or passcode didn't match. Please try again."); return; }
    setError(null);
    try { localStorage.setItem("lq_authed_user", match.username); } catch (e2) { /* ignore */ }
    onSuccess(match);
  };

  return React.createElement("div", {
    style: { background: "#FFFFFF", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px", fontFamily: "'Inter', sans-serif" }
  },
    React.createElement("form", {
      onSubmit: handleSubmit,
      style: { background: "#FFFFFF", border: "1px solid #E8B9BC", borderRadius: 16, padding: "36px 34px", width: "100%", maxWidth: 340, boxShadow: "0 4px 18px rgba(0,0,0,0.10)" }
    },
      React.createElement("div", { style: { fontFamily: "'Fraunces', serif", fontSize: 12.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "#C41230", fontWeight: 600, marginBottom: 6 } }, "Le Quartier"),
      React.createElement("h1", { style: { fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 22, color: "#1A1A1A", margin: "0 0 22px" } }, "Sales Dashboard Login"),
      React.createElement("label", { style: { fontSize: 12, color: "#4D4D4D", display: "block", marginBottom: 4 } }, "Username"),
      React.createElement("input", {
        type: "text", value: username, onChange: (e) => setUsername(e.target.value), autoComplete: "username",
        style: { width: "100%", boxSizing: "border-box", padding: "9px 12px", marginBottom: 14, borderRadius: 8, border: "1.5px solid #E8B9BC", fontSize: 13.5, color: "#1A1A1A", fontFamily: "'Inter', sans-serif" }
      }),
      React.createElement("label", { style: { fontSize: 12, color: "#4D4D4D", display: "block", marginBottom: 4 } }, "Passcode"),
      React.createElement("input", {
        type: "password", value: passcode, onChange: (e) => setPasscode(e.target.value), autoComplete: "current-password",
        style: { width: "100%", boxSizing: "border-box", padding: "9px 12px", marginBottom: 18, borderRadius: 8, border: "1.5px solid #E8B9BC", fontSize: 13.5, color: "#1A1A1A", fontFamily: "'Inter', sans-serif" }
      }),
      error && React.createElement("div", { style: { fontSize: 12.5, color: "#B3261E", marginBottom: 14 } }, error),
      React.createElement("button", {
        type: "submit",
        style: { width: "100%", padding: "10px 0", borderRadius: 8, border: "none", background: "#C41230", color: "#FFFFFF", fontWeight: 600, fontSize: 14, fontFamily: "'Fraunces', serif", cursor: "pointer" }
      }, "Log In")
    )
  );
}

function AuthGate() {
  const [checked, setChecked] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    let savedUsername = null;
    try { savedUsername = localStorage.getItem("lq_authed_user"); } catch (e) { /* ignore */ }
    const match = savedUsername ? CREDENTIALS.find((c) => c.username === savedUsername) : null;
    setUser(match || null);
    setChecked(true);
  }, []);

  const handleLogout = () => {
    try { localStorage.removeItem("lq_authed_user"); } catch (e) { /* ignore */ }
    setUser(null);
  };

  if (!checked) {
    return React.createElement("div", { style: { background: "#FFFFFF", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" } },
      React.createElement("span", { style: { color: "#7A7A7A", fontFamily: "'Inter', sans-serif", fontSize: 13.5 } }, "Loading\u2026")
    );
  }
  if (!user) return React.createElement(LoginScreen, { onSuccess: (u) => setUser(u) });
  return React.createElement(Dashboard, { user, onLogout: handleLogout });
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(React.createElement(AuthGate));

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
const DAY_CATEGORIES = ["Breads", "Pastries", "Desserts"];
const TAB_CATEGORIES = ["Breads", "Pastries", "Desserts", "Breakfast & Lunch"];

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

const LINE_COLORS = [
  "#B8722E", "#7A2E3A", "#5B7C99", "#8A9A5B", "#9C7A3C",
  "#5C4033", "#D98A6A", "#3D6B6B", "#A85751", "#6E5B9E",
  "#C9A227", "#4E7A4E", "#B0563F", "#7C6A46", "#8C4E63",
  "#5E7A8C", "#A4763A", "#6B7F3D", "#946B8F", "#79604A",
  "#4F8C7A",
];

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

// Breakfast & Lunch items only have ONE number per week (Toast doesn't break
// them out by day), so this returns both an all-time ranking and a per-week
// breakdown, so the dashboard can show either "most popular overall" or
// "most popular this specific week."
function computeBreakfastLunch(weeksSorted) {
  const totals = {};
  const byWeek = weeksSorted.map((w) => {
    const catData = w.data["Breakfast & Lunch"] || {};
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
  const nextBusiestRange = nextBusiest ? entry.day_forecast[nextBusiest] : null;

  let forecastSentence = "";
  if (nextWeekLabel && nextBusiest) {
    forecastSentence = ` For the week of ${nextWeekLabel}, expect the most demand on ${nextBusiest} (around ${nextBusiestRange.low[0].toFixed(1)}\u2013${nextBusiestRange.high[0].toFixed(1)} units) and the least on ${nextSoftest} (around ${nextSoftestVal.toFixed(1)} units) \u2014 see the day-by-day forecast table below for every day and all 4 weeks.`;
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
    style: { background: "#FBF6EC", border: "1px solid #D8C9A8", borderRadius: 6, padding: "10px 14px", boxShadow: "0 4px 14px rgba(58,42,30,0.15)", fontFamily: "'Inter', sans-serif" }
  },
    React.createElement("div", { style: { fontWeight: 700, color: "#3A2A1E", marginBottom: 6, fontSize: 12.5 } }, `${isForecast ? "Forecast (medium)" : "3-Wk Avg"} — ${label}`),
    rows.map((r) => React.createElement("div", {
      key: r.name,
      style: { fontSize: 12, color: "#5C4033", display: "flex", justifyContent: "space-between", gap: 16 }
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
  const weekHeaders = forecastLabels.map((l) => `Week of ${l}`);
  const cell = (v, bold) => React.createElement("div", {
    style: { display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.25 }
  },
    React.createElement("span", { style: { color: bold ? "#2E2015" : "#5C4033", fontWeight: bold ? 700 : 500 } }, v.med.toFixed(1)),
    React.createElement("span", { style: { color: "#9C8A6E", fontSize: 10 } }, `${v.low.toFixed(1)}\u2013${v.high.toFixed(1)}`)
  );

  return React.createElement("div", { style: { overflowX: "auto", marginTop: 12 } },
    React.createElement("table", { style: { borderCollapse: "collapse", width: "100%", fontSize: 11.5 } },
      React.createElement("thead", null,
        React.createElement("tr", null,
          React.createElement("th", { style: { textAlign: "left", padding: "5px 8px", color: "#8A7A63", fontWeight: 600, borderBottom: "1.5px solid #DCCDA8" } }, "Day"),
          weekHeaders.map((label) => React.createElement("th", { key: label, style: { textAlign: "right", padding: "5px 8px", color: "#8A7A63", fontWeight: 600, borderBottom: "1.5px solid #DCCDA8" } }, label))
        )
      ),
      React.createElement("tbody", null,
        days.map((day) => {
          const df = entry.day_forecast[day];
          return React.createElement("tr", { key: day },
            React.createElement("td", { style: { padding: "5px 8px", color: "#5C4033", fontWeight: 500, verticalAlign: "top" } }, day),
            df.med.map((_, i) => React.createElement("td", { key: i, style: { padding: "5px 8px" } },
              cell({ med: df.med[i], low: df.low[i], high: df.high[i] }, false)
            ))
          );
        }),
        React.createElement("tr", null,
          React.createElement("td", { style: { padding: "6px 8px", color: "#2E2015", fontWeight: 700, borderTop: "1.5px solid #DCCDA8", verticalAlign: "top" } }, "Total"),
          entry.forecast_med.map((_, i) => React.createElement("td", { key: i, style: { padding: "6px 8px", borderTop: "1.5px solid #DCCDA8" } },
            cell({ med: entry.forecast_med[i], low: entry.forecast_low[i], high: entry.forecast_high[i] }, true)
          ))
        )
      )
    ),
    React.createElement("div", { style: { fontSize: 10.5, color: "#9C8A6E", marginTop: 6 } }, "Each cell: medium estimate on top, low\u2013high range below.")
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
// Horizontal bar chart ranking Breakfast & Lunch items by total units sold
// across the loaded weeks — most popular at the top. This is the whole view
// for this category since there's no day-of-week breakdown to chart yet.
const BL_COLOR = "#9C5A22";
function PopularityBarChart({ items }) {
  const height = Math.max(220, items.length * 28 + 40);
  return React.createElement(ResponsiveContainer, { width: "100%", height },
    React.createElement(BarChart, {
      data: items, layout: "vertical", margin: { top: 4, right: 30, left: 4, bottom: 4 }
    },
      React.createElement(CartesianGrid, { stroke: "#EAE0C8", strokeDasharray: "0", horizontal: false }),
      React.createElement(XAxis, { type: "number", tick: { fill: "#8A7A63", fontSize: 11.5 }, axisLine: { stroke: "#D8C9A8" }, tickLine: false }),
      React.createElement(YAxis, { type: "category", dataKey: "item", width: 190, tick: { fill: "#5C4033", fontSize: 12 }, axisLine: false, tickLine: false }),
      React.createElement(Tooltip, {
        contentStyle: { background: "#FBF6EC", border: "1px solid #D8C9A8", borderRadius: 6, fontSize: 12, fontFamily: "'Inter', sans-serif" },
        labelStyle: { color: "#3A2A1E", fontWeight: 700 },
        cursor: { fill: "#EAE0C8", opacity: 0.5 },
        formatter: (v) => [v?.toFixed(1) + " units total", "Sold"],
      }),
      React.createElement(Bar, { dataKey: "total", fill: BL_COLOR, radius: [0, 4, 4, 0], isAnimationActive: false })
    )
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
      React.createElement(CartesianGrid, { stroke: "#EAE0C8", strokeDasharray: "0", vertical: false }),
      React.createElement(XAxis, { dataKey: "day", tick: { fill: "#8A7A63", fontSize: 12 }, axisLine: { stroke: "#D8C9A8" }, tickLine: false }),
      React.createElement(YAxis, { tick: { fill: "#8A7A63", fontSize: 11.5 }, axisLine: false, tickLine: false, width: 34 }),
      React.createElement(Tooltip, {
        contentStyle: { background: "#FBF6EC", border: "1px solid #D8C9A8", borderRadius: 6, fontSize: 12, fontFamily: "'Inter', sans-serif" },
        labelStyle: { color: "#3A2A1E", fontWeight: 700 },
        cursor: { fill: "#EAE0C8", opacity: 0.5 },
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
    style: { background: "#FBF6EC", border: "1px solid #DCCDA8", borderRadius: 14, padding: "18px 20px", boxShadow: "0 1px 3px rgba(58,42,30,0.06)" }
  },
    React.createElement("div", { style: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 16, color: "#2E2015", marginBottom: 2 } }, name),
    React.createElement("div", { style: { fontSize: 11.5, color: "#9C8A6E", marginBottom: 12 } }, "Current 3-week moving average, side by side by day of week"),
    days.length === 0
      ? React.createElement("div", { style: { textAlign: "center", color: "#A8977E", padding: "30px 0", fontSize: 12.5 } }, "No days selected — use the day filter above.")
      : React.createElement(SnapshotBarChart, { entry, days })
  );
}

function ItemDetailCard({ name, entry, color, labels, forecastLabels }) {
  const paragraph = useMemo(() => generateParagraph(name, entry, labels, forecastLabels), [name, entry, labels, forecastLabels]);
  const days = DAY_ORDER.filter((d) => entry.day_ma[d]);

  return React.createElement("div", {
    style: { background: "#FBF6EC", border: `1.5px solid ${color}55`, borderLeft: `5px solid ${color}`, borderRadius: 10, padding: "16px 18px" }
  },
    React.createElement("div", { style: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 15, color: "#2E2015", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 } },
      React.createElement("span", { style: { width: 10, height: 10, borderRadius: 99, background: color, display: "inline-block" } }),
      name
    ),
    React.createElement("p", { style: { fontSize: 13, lineHeight: 1.6, color: "#5C4033", margin: "0 0 6px" } }, paragraph),
    React.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, color: "#8A7A63", marginTop: 12, textTransform: "uppercase", letterSpacing: "0.05em" } }, "3-Wk Moving Avg by Day"),
    React.createElement("div", { style: { fontSize: 10.5, color: "#9C8A6E", marginBottom: 4 } }, "Each column is one calendar week (Mon\u2013Sun), starting on the date shown. Rows are that week's actual numbers for each day."),
    React.createElement("div", { style: { overflowX: "auto" } },
      React.createElement("table", { style: { borderCollapse: "collapse", width: "100%", fontSize: 11.5 } },
        React.createElement("thead", null,
          React.createElement("tr", null,
            React.createElement("th", { style: { textAlign: "left", padding: "5px 8px", color: "#8A7A63", fontWeight: 600, borderBottom: "1.5px solid #DCCDA8" } }, "Day"),
            labels.map((label) => React.createElement("th", { key: label, style: { textAlign: "right", padding: "5px 8px", color: "#8A7A63", fontWeight: 600, borderBottom: "1.5px solid #DCCDA8" } }, `Week of ${label}`))
          )
        ),
        React.createElement("tbody", null,
          days.map((day) => React.createElement("tr", { key: day },
            React.createElement("td", { style: { padding: "4px 8px", color: "#5C4033", fontWeight: 500 } }, day),
            entry.day_ma[day].map((v, i) => React.createElement("td", { key: i, style: { padding: "4px 8px", textAlign: "right", color: "#5C4033" } }, v.toFixed(1)))
          )),
          React.createElement("tr", null,
            React.createElement("td", { style: { padding: "5px 8px", color: "#2E2015", fontWeight: 700, borderTop: "1.5px solid #DCCDA8" } }, "Total"),
            entry.total_ma.map((v, i) => React.createElement("td", { key: i, style: { padding: "5px 8px", textAlign: "right", color: "#2E2015", fontWeight: 700, borderTop: "1.5px solid #DCCDA8" } }, v.toFixed(1)))
          )
        )
      )
    ),
    React.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, color: "#8A7A63", marginTop: 14, textTransform: "uppercase", letterSpacing: "0.05em" } }, "Next 4 Weeks — Forecast, by Day"),
    React.createElement(ForecastTable, { entry, forecastLabels, days })
  );
}

// One consistent color per day of week, used everywhere a chart breaks data
// out by day — so "Saturday" is always the same color across every item's
// chart, every category, every location.
const DAY_COLORS = {
  Monday: "#8A9A5B",
  Tuesday: "#5B7C99",
  Wednesday: "#B8722E",
  Thursday: "#7A2E3A",
  Friday: "#9C7A3C",
  Saturday: "#5C4033",
  Sunday: "#D98A6A",
};

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

function Dashboard({ user, onLogout }) {
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const w = await loadWeeksForLocation(location);
      if (!cancelled) { setWeeks(w); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [location]);

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
    setLocation(loc);
    setCategory("Breads");
    setActiveItems(new Set(DEFAULT_ACTIVE["Breads"]));
    setBlWeek("total");
  };
  const switchCategory = (cat) => {
    setCategory(cat);
    setActiveItems(new Set(DEFAULT_ACTIVE[cat] || []));
  };
  const toggleItem = (name) => {
    setActiveItems((prev) => (prev.has(name) ? new Set() : new Set([name])));
  };

  const activeList = itemNames.filter((n) => activeItems.has(n));
  const blData = useMemo(() => computeBreakfastLunch(weeks), [weeks]);
  const [blWeek, setBlWeek] = useState("total");
  const blSelected = blWeek === "total" ? blData.total : (blData.byWeek.find((w) => w.date === blWeek) || {}).items || [];

  return React.createElement("div", {
    style: { background: "#EFE6D5", minHeight: "100vh", padding: "36px 28px 44px", fontFamily: "'Inter', sans-serif", color: "#3A2A1E" }
  },
    React.createElement("style", null, `
      .lq-loc-tab, .lq-cat-tab, .lq-item-chip { transition: all 0.15s ease; }
      .lq-loc-tab:hover, .lq-cat-tab:hover { transform: translateY(-1px); filter: brightness(1.04); }
      .lq-item-chip:hover { transform: translateY(-1px); box-shadow: 0 2px 6px rgba(58,42,30,0.10); }
      .lq-day-card { transition: box-shadow 0.15s ease, transform 0.15s ease; }
      .lq-day-card:hover { box-shadow: 0 4px 14px rgba(58,42,30,0.12); transform: translateY(-2px); }
      .lq-logout:hover { color: #9C5A22; }
    `),
    React.createElement("div", { style: { maxWidth: 1080, margin: "0 auto" } },
      React.createElement("div", { style: { display: "flex", justifyContent: "flex-end", marginBottom: 10 } },
        React.createElement("span", { style: { fontSize: 12, color: "#8A7A63" } },
          "Signed in as ", React.createElement("strong", { style: { color: "#5C4033" } }, user.displayName), " \u00b7 ",
          React.createElement("span", { className: "lq-logout", onClick: onLogout, style: { color: "#B8722E", cursor: "pointer", textDecoration: "underline" } }, "Log out")
        )
      ),
      React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" } },
        LOCATION_NAMES.map((loc) => React.createElement("div", {
          key: loc, className: "lq-loc-tab", onClick: () => switchLocation(loc),
          style: {
            padding: "10px 22px", borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: "'Fraunces', serif", cursor: "pointer",
            background: location === loc ? "#B8722E" : "#FBF6EC",
            color: location === loc ? "#FBF6EC" : "#6B5A46",
            border: `1.5px solid ${location === loc ? "#B8722E" : "#DCCDA8"}`,
            boxShadow: location === loc ? "0 2px 6px rgba(184,114,46,0.35)" : "none",
          }
        }, loc))
      ),
      React.createElement("div", { style: { marginBottom: 6, display: "flex", alignItems: "baseline", gap: 10 } },
        React.createElement("span", { style: { fontFamily: "'Fraunces', serif", fontSize: 13, letterSpacing: "0.14em", textTransform: "uppercase", color: "#B8722E", fontWeight: 600 } }, `${location} Location`),
        React.createElement("span", { style: { fontSize: 12, color: "#8A7A63" } }, "3-Week Moving Average & 4-Week Forecast")
      ),
      React.createElement("h1", { style: { fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 32, lineHeight: 1.15, margin: "0 0 8px", color: "#2E2015" } }, "Item demand, past and projected"),
      React.createElement("p", { style: { fontSize: 14, color: "#6B5A46", maxWidth: 680, lineHeight: 1.6, margin: "0 0 20px" } },
        "Add or remove an item's line with the buttons below. Solid lines are the actual 3-week moving average; dashed lines and shaded bands are the next 4 weeks' projected range (low \u2013 high). Click any item to see its per-day breakdown and forecast numbers underneath."
      ),

      React.createElement("div", {
        style: {
          background: "#3A2A1E", borderRadius: 14, padding: "20px 24px", marginBottom: 26,
          display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14,
          boxShadow: "0 2px 10px rgba(58,42,30,0.18)",
        }
      },
        React.createElement("div", null,
          React.createElement("div", { style: { fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 16.5, color: "#F3E9D2", marginBottom: 3 } },
            "3-Week Moving Average \u2014 Every Item, Every Day, Every Location"
          ),
          React.createElement("div", { style: { fontSize: 12, color: "#D8C9A8", maxWidth: 560, lineHeight: 1.5 } },
            "The full breakdown behind this dashboard, in one spreadsheet: all 4 locations, every item, broken out by day of week, across all 8 weeks of data (May 25 \u2013 Jul 19, 2026)."
          )
        ),
        React.createElement("a", {
          href: "LeQuartier_Moving_Average_All_Locations.xlsx",
          download: "LeQuartier_Moving_Average_All_Locations.xlsx",
          style: {
            display: "inline-flex", alignItems: "center", gap: 8, padding: "11px 22px", borderRadius: 8,
            background: "#B8722E", color: "#FBF6EC", fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 13.5,
            textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0,
          }
        }, "\u2B07 Download Full Report (.xlsx)")
      ),

      loading ? React.createElement("div", { style: { textAlign: "center", color: "#A8977E", padding: "40px 0", fontSize: 13.5 } }, `Loading ${location}'s data\u2026`)
      : !hasData ? React.createElement("div", {
          style: { background: "#FBF6EC", border: "1.5px dashed #DCCDA8", borderRadius: 14, padding: "40px 30px", textAlign: "center" }
        },
          React.createElement("div", { style: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 18, color: "#2E2015", marginBottom: 8 } }, `No data yet for ${location}`),
          React.createElement("p", { style: { fontSize: 13.5, color: "#6B5A46", maxWidth: 460, margin: "0 auto", lineHeight: 1.6 } },
            `Add a data/${location.toLowerCase()}.json file (same format as Edgewood) and push it to the repo to populate this tab.`
          )
        )
      : React.createElement(React.Fragment, null,
          React.createElement("div", { style: { fontSize: 12.5, color: "#8A7A63", marginBottom: 18 } }, `${weeks.length} week${weeks.length === 1 ? "" : "s"} of data loaded`),

          React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 22 } },
            TAB_CATEGORIES.map((cat) => React.createElement("div", {
              key: cat, className: "lq-cat-tab", onClick: () => switchCategory(cat),
              style: {
                padding: "9px 20px", borderRadius: 999, fontSize: 13.5, fontWeight: 600, fontFamily: "'Fraunces', serif", cursor: "pointer",
                background: category === cat ? "#3A2A1E" : "#FBF6EC",
                color: category === cat ? "#F3E9D2" : "#6B5A46",
                border: `1.5px solid ${category === cat ? "#3A2A1E" : "#DCCDA8"}`,
              }
            }, cat))
          ),

          category === "Breakfast & Lunch"
            ? blData.total.length === 0
              ? React.createElement("div", {
                  style: { background: "#FBF6EC", border: "1.5px dashed #DCCDA8", borderRadius: 14, padding: "40px 30px", textAlign: "center" }
                },
                  React.createElement("div", { style: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 17, color: "#2E2015", marginBottom: 8 } }, `No Breakfast & Lunch data for ${location}`),
                  React.createElement("p", { style: { fontSize: 13.5, color: "#6B5A46", maxWidth: 480, margin: "0 auto", lineHeight: 1.6 } },
                    `${location} doesn't tag items as "Breakfast" or "Lunch" in Toast the way Edgewood does — it uses different category names for this kind of menu. Once it's confirmed which of ${location}'s categories are the equivalent, this tab can be filled in the same way.`
                  )
                )
              : React.createElement(React.Fragment, null,
                  React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 16 } },
                    React.createElement("div", {
                      className: "lq-item-chip", onClick: () => setBlWeek("total"),
                      style: {
                        padding: "6px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                        border: `1.5px solid ${blWeek === "total" ? BL_COLOR : "#DCCDA8"}`,
                        background: blWeek === "total" ? `${BL_COLOR}1A` : "transparent",
                        color: blWeek === "total" ? "#2E2015" : "#A8977E",
                      }
                    }, "All Weeks (Total)"),
                    blData.byWeek.map((w) => React.createElement("div", {
                      key: w.date, className: "lq-item-chip", onClick: () => setBlWeek(w.date),
                      style: {
                        padding: "6px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 500, cursor: "pointer",
                        border: `1.5px solid ${blWeek === w.date ? BL_COLOR : "#DCCDA8"}`,
                        background: blWeek === w.date ? `${BL_COLOR}1A` : "transparent",
                        color: blWeek === w.date ? "#2E2015" : "#A8977E",
                      }
                    }, `Week of ${w.label}`))
                  ),
                  React.createElement("div", { style: { background: "#FBF6EC", border: "1px solid #DCCDA8", borderRadius: 14, padding: "20px 20px 8px", boxShadow: "0 1px 3px rgba(58,42,30,0.06)" } },
                    React.createElement("div", { style: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 15, color: "#2E2015", marginBottom: 2 } }, "Most Popular Items"),
                    React.createElement("div", { style: { fontSize: 11.5, color: "#9C8A6E", marginBottom: 14 } },
                      blWeek === "total"
                        ? `Total units sold, all ${weeks.length} loaded weeks combined — no day-of-week breakdown available for this category yet.`
                        : `Units sold the week of ${blData.byWeek.find((w) => w.date === blWeek)?.label} only.`
                    ),
                    blSelected.length === 0
                      ? React.createElement("div", { style: { textAlign: "center", color: "#A8977E", padding: "30px 0", fontSize: 12.5 } }, "No items recorded for this week.")
                      : React.createElement(PopularityBarChart, { items: blSelected })
                  )
                )
            : React.createElement(React.Fragment, null,
                React.createElement("div", { style: { background: "#FBF6EC", border: "1px solid #DCCDA8", borderRadius: 14, padding: "18px 20px", marginBottom: 18 } },
                  React.createElement("div", { style: { fontSize: 12.5, color: "#8A7A63", marginBottom: 12 } }, `${activeItems.size} of ${itemNames.length} items on the chart.`),
                  React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 7 } },
                    itemNames.map((name) => {
                      const active = activeItems.has(name);
                      const color = colorForItem[name];
                      return React.createElement("div", {
                        key: name, className: "lq-item-chip", onClick: () => toggleItem(name),
                        style: {
                          display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 500, cursor: "pointer",
                          border: `1.5px solid ${active ? color : "#DCCDA8"}`,
                          background: active ? `${color}1A` : "transparent",
                          color: active ? "#2E2015" : "#A8977E",
                        }
                      },
                        React.createElement("span", { style: { width: 8, height: 8, borderRadius: 99, background: active ? color : "#D8C9A8", display: "inline-block" } }),
                        name
                      );
                    })
                  )
                ),

                React.createElement("div", { style: { marginBottom: 4 } },
                  React.createElement("div", { style: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 15, color: "#2E2015" } }, "3-Week Moving Average — by Item, by Day of Week"),
                  React.createElement("div", { style: { fontSize: 12, color: "#8A7A63", marginBottom: 14, maxWidth: 700, lineHeight: 1.5 } },
                    "The 4-week forecast (low/medium/high) is in the numbers table below each item, not on the chart, to keep these simple."
                  )
                ),

                React.createElement("div", { style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px", marginBottom: 18 } },
                  React.createElement("span", { style: { fontSize: 11.5, color: "#8A7A63", fontWeight: 600 } }, "Show days:"),
                  DAY_ORDER.map((day) => {
                    const on = visibleDays.has(day);
                    return React.createElement("div", {
                      key: day, className: "lq-item-chip", onClick: () => toggleDay(day),
                      style: {
                        display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 500, cursor: "pointer",
                        border: `1.5px solid ${on ? DAY_COLORS[day] : "#DCCDA8"}`,
                        background: on ? `${DAY_COLORS[day]}1A` : "transparent",
                        color: on ? "#2E2015" : "#A8977E",
                      }
                    },
                      React.createElement("span", { style: { width: 7, height: 7, borderRadius: 99, background: on ? DAY_COLORS[day] : "#D8C9A8", display: "inline-block" } }),
                      day.slice(0, 3)
                    );
                  })
                ),

                activeList.length === 0
                  ? React.createElement("div", { style: { background: "#FBF6EC", border: "1px solid #DCCDA8", borderRadius: 14, textAlign: "center", color: "#A8977E", padding: "60px 0", fontSize: 13.5, marginBottom: 22 } }, "Select an item above to see its day-of-week trend.")
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

          React.createElement("div", { style: { fontSize: 11, color: "#A8977E", marginTop: 26, textAlign: "center" } },
            `Source: Toast Product Mix (PMIX) exports, ${location} location, weekly Mon\u2013Sun totals. Forecasts use a simple linear trend fit to the available weeks; low/high bands reflect historical week-to-week variability. Bagels are grouped under Pastries.`
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
    style: { background: "#EFE6D5", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px", fontFamily: "'Inter', sans-serif" }
  },
    React.createElement("form", {
      onSubmit: handleSubmit,
      style: { background: "#FBF6EC", border: "1px solid #DCCDA8", borderRadius: 16, padding: "36px 34px", width: "100%", maxWidth: 340, boxShadow: "0 4px 18px rgba(58,42,30,0.10)" }
    },
      React.createElement("div", { style: { fontFamily: "'Fraunces', serif", fontSize: 12.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "#B8722E", fontWeight: 600, marginBottom: 6 } }, "Le Quartier"),
      React.createElement("h1", { style: { fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 22, color: "#2E2015", margin: "0 0 22px" } }, "Sales Dashboard Login"),
      React.createElement("label", { style: { fontSize: 12, color: "#8A7A63", display: "block", marginBottom: 4 } }, "Username"),
      React.createElement("input", {
        type: "text", value: username, onChange: (e) => setUsername(e.target.value), autoComplete: "username",
        style: { width: "100%", boxSizing: "border-box", padding: "9px 12px", marginBottom: 14, borderRadius: 8, border: "1.5px solid #DCCDA8", fontSize: 13.5, color: "#3A2A1E", fontFamily: "'Inter', sans-serif" }
      }),
      React.createElement("label", { style: { fontSize: 12, color: "#8A7A63", display: "block", marginBottom: 4 } }, "Passcode"),
      React.createElement("input", {
        type: "password", value: passcode, onChange: (e) => setPasscode(e.target.value), autoComplete: "current-password",
        style: { width: "100%", boxSizing: "border-box", padding: "9px 12px", marginBottom: 18, borderRadius: 8, border: "1.5px solid #DCCDA8", fontSize: 13.5, color: "#3A2A1E", fontFamily: "'Inter', sans-serif" }
      }),
      error && React.createElement("div", { style: { fontSize: 12.5, color: "#A85751", marginBottom: 14 } }, error),
      React.createElement("button", {
        type: "submit",
        style: { width: "100%", padding: "10px 0", borderRadius: 8, border: "none", background: "#B8722E", color: "#FBF6EC", fontWeight: 600, fontSize: 14, fontFamily: "'Fraunces', serif", cursor: "pointer" }
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
    return React.createElement("div", { style: { background: "#EFE6D5", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" } },
      React.createElement("span", { style: { color: "#A8977E", fontFamily: "'Inter', sans-serif", fontSize: 13.5 } }, "Loading\u2026")
    );
  }
  if (!user) return React.createElement(LoginScreen, { onSuccess: (u) => setUser(u) });
  return React.createElement(Dashboard, { user, onLogout: handleLogout });
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(React.createElement(AuthGate));

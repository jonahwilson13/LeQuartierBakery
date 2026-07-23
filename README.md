# Le Quartier — Sales Dashboard

A static, no-build website showing weekly sales trends, 3-week moving averages,
and 4-week forecasts by item, for each Le Quartier location.

## One-time setup (GitHub Pages)

1. Create a new GitHub repo (e.g. `Le-Quartier-Sales`), same way you set up Atlas-Wealth-Management.
2. Upload all the files in this folder to that repo (`index.html`, `app.js`, `update_data.py`, `data/` folder and its 4 files).
3. In the repo, go to **Settings > Pages**.
4. Under "Build and deployment", set **Source** to "Deploy from a branch", branch `main`, folder `/ (root)`.
5. Save. GitHub will give you a URL like `https://jonahwilson13.github.io/Le-Quartier-Sales/` — that's the live link.
6. Give that link to your boss, along with his username (`sethquiring`) and passcode (`4025604770`) — send those two things separately, not in the same message.

The site works exactly like the version we built in Claude: location tabs, category tabs,
item toggles, the combined chart with forecast, and the per-item detail cards with the
generated paragraph, day-by-day moving averages, and 4-week low/medium/high forecast.

## Adding a new week of data

Each week, once you've exported Toast's Product Mix (PMIX) report for one location and unzipped it:

```bash
python3 update_data.py --location edgewood --week-start 2026-07-20 --csv "All levels.csv"
```

- `--location` is one of: `edgewood`, `meridian`, `dundee`, `loveland`
- `--week-start` is the Monday of that week
- `--csv` is the path to the `All levels.csv` file from the unzipped export

The script updates `data/<location>.json` in place. Then push it:

```bash
git add data/edgewood.json
git commit -m "Add week of 2026-07-20 for Edgewood"
git push
```

Refresh the live site and the new week appears — charts, moving averages, and forecasts
all recalculate automatically from the updated file.

## Notes and honest limitations

- **Login is a convenience gate, not real security.** The username/passcode check runs in
  the page's own code (visible in `app.js`), not on a private server. It stops casual access
  but wouldn't stop someone determined to view the source. Fine for keeping this between the
  two of you; don't treat it as bank-grade security.
- **No live in-browser upload.** Unlike the Claude version, this static site can't accept a
  file upload directly in the browser — updating data means running `update_data.py` locally
  and pushing to GitHub, same pattern as Atlas.
- **Breakfast & Lunch items aren't included.** Toast's export doesn't break those out by day
  of week the way it does for Bread/Pastry/Dessert, so they're left out of this tool.
- **Bagels are grouped under Pastries** regardless of what category Toast assigns them, to
  match how you wanted the dashboard organized.

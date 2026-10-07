name: Stock snapshot

# Publishes a read-only stock CSV for Dan's order-form generator to the
# "stock-snapshot" branch. It never touches main, so the Pages site is not
# rebuilt. Read it at:
# https://raw.githubusercontent.com/rachelnicklin-cmyk/Inventory-Tracker-2/stock-snapshot/stock_snapshot.csv
on:
  schedule:
    - cron: '*/15 * * * *'
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: stock-snapshot
  cancel-in-progress: false

jobs:
  snapshot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: main
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Build snapshot (read-only Firestore reads)
        run: node tools/stock-snapshot.mjs
      - name: Publish to stock-snapshot branch
        run: |
          mkdir /tmp/out && cp stock_snapshot.csv /tmp/out/
          cd /tmp/out
          git init -q -b stock-snapshot
          git config user.name  "stock-snapshot bot"
          git config user.email "actions@users.noreply.github.com"
          git add stock_snapshot.csv
          git commit -q -m "Stock snapshot $(date -u +%Y-%m-%dT%H:%MZ)"
          git push -q --force "https://x-access-token:${{ github.token }}@github.com/${{ github.repository }}.git" stock-snapshot

#!/bin/bash
set -euo pipefail

OUTDIR="assets/data"
OUTFILE="$OUTDIR/geonames_cities.tsv"
TMPDIR=$(mktemp -d)

echo "Downloading GeoNames cities1000..."
curl -sL "https://download.geonames.org/export/dump/cities1000.zip" -o "$TMPDIR/cities1000.zip"

echo "Extracting..."
unzip -q "$TMPDIR/cities1000.zip" -d "$TMPDIR"

echo "Processing into TSV (name, lat, lng, countryCode, population)..."
mkdir -p "$OUTDIR"
awk -F'\t' 'BEGIN{OFS="\t"} {print $2, $5, $6, $9, $14}' "$TMPDIR/cities1000.txt" > "$OUTFILE"

LINES=$(wc -l < "$OUTFILE" | tr -d ' ')
SIZE=$(du -h "$OUTFILE" | cut -f1)
echo "Done: $OUTFILE ($LINES cities, $SIZE)"

rm -rf "$TMPDIR"

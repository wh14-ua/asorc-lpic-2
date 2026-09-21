#!/usr/bin/env bash
# Regenera el banco de preguntas y el informe de verificación desde los PDFs.
#
#   ./tools/extract.sh
#
# Requiere: pdftotext (poppler-utils) y python3.
set -euo pipefail

PROJ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${ASORC_WORK:-$PROJ/tools/_work}"
PDF1="${ASORC_PDF1:-$PROJ/LPIC-2-Linux-inglés.pdf}"
PDF2="${ASORC_PDF2:-$PROJ/lpic-2-linux.pdf}"
export ASORC_WORK="$WORK" ASORC_PROJ="$PROJ" ASORC_PDF1="$PDF1"

for f in "$PDF1" "$PDF2"; do
  [ -f "$f" ] || { echo "Falta el PDF: $f" >&2; exit 1; }
done
command -v pdftotext >/dev/null || { echo "Falta pdftotext (instala poppler-utils)" >&2; exit 1; }

mkdir -p "$WORK/raw"

echo "==> 1/4  Volcando texto de los PDFs"
pdftotext -layout "$PDF1" "$WORK/raw/book1_layout.txt" 2>/dev/null
pdftotext -layout "$PDF2" "$WORK/raw/book2_layout.txt" 2>/dev/null
pdftotext          "$PDF1" "$WORK/raw/book1_raw.txt"    2>/dev/null
pdftotext          "$PDF2" "$WORK/raw/book2_raw.txt"    2>/dev/null

python3 - <<PY
import os
WORK = os.environ["ASORC_WORK"]
for tag in ("book1", "book2"):
    src = f"{WORK}/raw/{tag}_layout.txt"
    pages = open(src, encoding="utf-8", errors="replace").read().split("\f")
    if pages and not pages[-1].strip():
        pages = pages[:-1]
    out = "\n".join(f"<<<PDFPAGE {i}>>>\n{p}" for i, p in enumerate(pages, 1))
    open(f"{WORK}/raw/{tag}_layout_paged.txt", "w", encoding="utf-8").write(out)
    print(f"    {tag}: {len(pages)} páginas")
PY

echo "==> 2/4  Extrayendo preguntas del libro 1"
python3 "$PROJ/tools/extract_book1.py"

echo "==> 3/4  Construyendo questions.json"
python3 "$PROJ/tools/build_questions.py"

echo "==> 4/4  Verificando y generando extraction_report.md"
python3 "$PROJ/tools/report.py"

echo
echo "Listo:"
echo "  $PROJ/questions.json"
echo "  $PROJ/extraction_report.md"

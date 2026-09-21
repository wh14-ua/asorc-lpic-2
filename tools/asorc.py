# -*- coding: utf-8 -*-
import os
"""ASORC 3-option reduction: keep the correct option, pick 2 'reasonable'
ORIGINAL distractors. Deterministic; never alters the correct answer."""
import re, difflib

def _shape(t):
    s = t.strip()
    if re.match(r"^/", s):                       return "path"
    if re.match(r"^-{1,2}\S", s):                return "flag"
    if re.match(r"^\d+(\.\d+)*$", s):            return "number"
    if re.match(r"^[A-Za-z][\w.+-]*$", s) and " " not in s: return "token"
    if len(s.split()) >= 6:                      return "sentence"
    return "phrase"

def _trigrams(s):
    s = " " + re.sub(r"\s+", " ", s.lower().strip()) + " "
    return {s[i:i+3] for i in range(max(0, len(s)-2))}

def _sim(a, b):
    ta, tb = _trigrams(a), _trigrams(b)
    if not ta or not tb:
        return 0.0
    jac = len(ta & tb) / len(ta | tb)
    seq = difflib.SequenceMatcher(None, a.lower(), b.lower()).ratio()
    return 0.5 * jac + 0.5 * seq

def score_distractor(correct_text, d_text, expl, d_label):
    """Higher = better distractor."""
    s = 0.0
    if _shape(d_text) == _shape(correct_text):
        s += 1.0                       # same surface kind: keeps question discriminating
    s += 1.2 * _sim(correct_text, d_text)
    la, lb = len(correct_text), len(d_text)
    s += 0.4 * (min(la, lb) / max(la, lb, 1))
    # the book explicitly reasons about this option -> it is a considered distractor
    if expl and re.search(rf"\boption {d_label}\b", expl, re.I):
        s += 0.6
    return s

def pick_asorc(options, correct_labels, expl):
    """options: [{'label','text'}]; correct_labels: list w/ exactly 1 label.
    Returns (kept_labels_in_original_order, correct_label) or None."""
    if len(correct_labels) != 1:
        return None
    cl = correct_labels[0]
    by = {o["label"]: o["text"] for o in options}
    if cl not in by:
        return None
    if len(options) <= 3:
        return [o["label"] for o in options], cl
    wrong = [o for o in options if o["label"] != cl]
    ranked = sorted(
        wrong,
        key=lambda o: (-score_distractor(by[cl], o["text"], expl, o["label"]), o["label"]),
    )
    keep = {cl, ranked[0]["label"], ranked[1]["label"]}
    kept = [o["label"] for o in options if o["label"] in keep]
    return kept, cl

CHOOSE_ALL_RE = re.compile(
    r"\s*\((?:choose|select)\s+(?:all\s+that\s+apply|the\s+two\s+best\s+answers?|"
    r"two|three|all\s+that\s+applies)\.?\)\s*", re.I)

def asorc_stem(question):
    """Faithful stem for a 3-option / single-answer rendering: drop a trailing
    'choose all that apply'-style instruction that would contradict the format."""
    out = CHOOSE_ALL_RE.sub(" ", question).strip()
    out = re.sub(r"\s+", " ", out)
    return out

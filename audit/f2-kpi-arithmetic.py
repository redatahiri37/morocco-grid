#!/usr/bin/env python3
"""F2 — the same arithmetic straight from the committed GeoJSON, no browser."""
import json, os
D = os.path.join(os.path.dirname(__file__), "..", "data", "morocco")
fs = json.load(open(os.path.join(D, "power-plants.geojson")))["features"]
cap = lambda f: f["properties"].get("capacity_mw") or 0
ft  = lambda f: f["properties"].get("fuel_type", "")
st  = lambda f: f["properties"].get("status")
tot      = sum(map(cap, fs))
coded    = sum(cap(f) for f in fs if ft(f) in ("solar", "wind", "hydro"))
correct  = sum(cap(f) for f in fs if ft(f).split("_")[0] in ("solar", "wind", "hydro"))
ops      = [f for f in fs if st(f) == "operational"]
op_tot   = sum(map(cap, ops))
op_ren   = sum(cap(f) for f in ops if ft(f).split("_")[0] in ("solar", "wind", "hydro"))
print(f"fuel_type values          {sorted({ft(f) for f in fs})}")
print(f"features with 'solar'     {sum(1 for f in fs if ft(f)=='solar')}")
print(f"denominator               {tot} MW")
print(f"numerator as coded        {coded} MW -> {round(100*coded/tot)}%   <-- DISPLAYED")
print(f"numerator corrected       {correct} MW -> {round(100*correct/tot)}%")
print(f"operational-only          {op_ren}/{op_tot} -> {round(100*op_ren/op_tot)}%")
print(f"solar MW dropped          {correct-coded} MW")
print(f"pumped_storage counted    {sum(cap(f) for f in fs if ft(f)=='pumped_storage')} MW")
print(f"not-yet-built counted     {tot-op_tot} MW")
assert round(100*coded/tot) == 23 and round(100*correct/tot) == 39
print("\nF2 REPRODUCED")

# Third-party notices

This file lists third-party source code that was ported or adapted into this repository. It does not list the packages
installed from `pyproject.toml` and `uv.lock`; those keep their own licenses.

## meteoHazard (Thermal Work Limit solver)

`src/stellar_blaze/domain/physics/twl.py` is a Python port of parts of the R package **meteoHazard**.

| | |
|---|---|
| Repository | https://github.com/vorpalvorpal/meteoHazard |
| Commit ported | `5633d5719225d15d84f2608189e2b3d654dba73d` (package version 0.4.0) |
| License | `License: MIT + file LICENSE` (from `DESCRIPTION` at that commit) |
| Copyright | 2026, TWL authors (from `LICENSE` at that commit); `DESCRIPTION` names R. Shannon as author and maintainer |
| Files ported | `R/solve_twl.R` (`solve_twl_single`, `three_zone_evaporation`), `R/constants.R` (TWL constants), `R/psychrometrics.R` (saturation vapor pressure), `R/generate_twl.R` (wind-height correction, wind limits, withdrawal limits) |
| Changes | Translated from R to Python; scalar solver plus array wrapper; input validation and NaN policy added; the withdrawal limits are a separate function; constants and equation citations kept as in the source |

Notes:

- The package's `DESCRIPTION` cites the wrong DOI for the paper it implements (`10.1080/104732202317070947`). The paper
  is Brake and Bates (2002), *Applied Occupational and Environmental Hygiene* 17(3):176-186, DOI
  `10.1080/104732202753438261`.
- The equations were not checked against the primary paper (not available to us); the port is checked against Miller
  and Bates (2007) Table 2 instead (`tests/unit/physics/test_twl.py`, ADR 0006).
- `tests/unit/physics/test_twl.py` also contains the Brake and Bates (2002) Table 1 values (62 rows and two worked
  examples) as transcribed in the package's `tests/testthat/test-twl-table1.R` at the same commit, with the same
  tolerances. We did not check the transcription against the paper.

### License text

The `LICENSE` file at the ported commit reads, verbatim:

```
YEAR: 2026
COPYRIGHT HOLDER: TWL authors
```

That file is the CRAN stub of the "MIT + file LICENSE" form: it names the year and the holder, and the terms are those
of the standard MIT license. The text below is the standard MIT license (as published by the OSI, not copied from the
package) with the year and holder taken from the stub:

```
MIT License

Copyright (c) 2026 TWL authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

"""Array type alias shared by every physics module (psychrometrics, solar, WBGT, NIOSH, TWL)."""

import numpy as np
from numpy.typing import NDArray

F64 = NDArray[np.float64]

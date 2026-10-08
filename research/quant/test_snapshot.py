"""No-lookahead test for the state engine: the snapshot at bar i must not change when future bars change."""
import numpy as np, pandas as pd
from snapshot import snapshot_matrix, W

def test_no_lookahead():
    rng = np.random.default_rng(1)
    n = 400
    c = 0.3 * np.exp(np.cumsum(rng.normal(0, 0.01, n)))
    df = pd.DataFrame({"t": np.arange(n) * 3600, "o": c, "h": c * 1.004, "l": c * 0.996, "c": c, "v": rng.uniform(1, 2, n)})
    X1, _ = snapshot_matrix(df, 3600)
    df2 = df.copy(); df2.loc[300:, ["o", "h", "l", "c"]] *= 1.5; df2.loc[300:, "v"] *= 9
    X2, _ = snapshot_matrix(df2, 3600)
    assert np.allclose(X1[W - 1:300], X2[W - 1:300]), "snapshot used data from a later bar"
    assert not np.allclose(X1[300], X2[300])

if __name__ == "__main__":
    test_no_lookahead(); print("ok: snapshot uses no future bars")

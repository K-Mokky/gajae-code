### Fixed

- Broker-launched sessions can set and unset per-session subprocess environment variables, retain them across resume, and inspect them by name without exposing values. Runtime preload and native-loader controls are rejected before the session host starts.

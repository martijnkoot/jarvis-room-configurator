# ADR-001: Runtime independence

Status: Accepted

Jarvis Room Configurator is an optional setup and diagnostic tool.

- ESPHome roomnodes own LD2460 detection, zone computation and runtime state.
- Home Assistant and Music Assistant consume the existing ESPHome entities.
- The configurator must never own or replace those entities or continuously
  calculate occupancy as a service.
- No device configuration is changed without an explicit apply action.
- Device state is read back and verified after any future write.
- Removing the configurator must not break detection or automation.

Acceptance test for future write-enabled releases: configure zones, verify
entities, uninstall configurator, restart HA and roomnodes, verify again.

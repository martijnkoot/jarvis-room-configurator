"""Optional Jarvis configurator: no radar writes or background subscriptions."""

from pathlib import Path
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

URL = "/jarvis_room_configurator/target-card.js"

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Serve the optional read-only frontend card."""
    await hass.http.async_register_static_paths([
        StaticPathConfig(URL, str(Path(__file__).parent / "frontend" / "target-card.js"), False)
    ])
    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """No services, devices, or listeners to tear down."""
    return True

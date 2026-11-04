"""UI setup flow for Jarvis Room Configurator."""

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult

from .const import DOMAIN


class JarvisRoomConfiguratorConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Set up one optional configurator instance."""

    VERSION = 1

    async def async_step_user(self, user_input: dict | None = None) -> FlowResult:
        """Create the configurator without touching ESPHome."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if user_input is not None:
            return self.async_create_entry(title="Jarvis Room Configurator", data={})
        return self.async_show_form(step_id="user")

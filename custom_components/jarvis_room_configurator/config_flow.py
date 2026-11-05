"""Configuration flow for Jarvis Room Configurator."""

from homeassistant import config_entries
from homeassistant.config_entries import ConfigFlowResult

from .const import DOMAIN


class JarvisRoomConfiguratorConfigFlow(
    config_entries.ConfigFlow, domain=DOMAIN
):
    """Set up the optional Jarvis Room Configurator."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict | None = None
    ) -> ConfigFlowResult:
        """Create a configurator instance."""
        if user_input is not None:
            await self.async_set_unique_id(DOMAIN)
            self._abort_if_unique_id_configured()

            return self.async_create_entry(
                title="Jarvis Room Configurator",
                data={},
            )

        return self.async_show_form(step_id="user")

import { SETTINGS_FILE } from "./constants.js";

export class SettingsError extends Error {
  constructor(reason: string) {
    super(`${SETTINGS_FILE}: ${reason}`);
    this.name = "SettingsError";
  }
}

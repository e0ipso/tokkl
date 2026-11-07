/**
 * An invalid deployment setting. Its message names the setting and holds no secret, so startup
 * prints it, unlike other startup errors, which can carry connection details.
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}
